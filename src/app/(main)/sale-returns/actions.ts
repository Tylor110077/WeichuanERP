"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { applyStockChange } from "@/lib/stock-cost";
import { buildOrderNo, ORDER_NO_PREFIXES, todayCompact } from "@/lib/order-no";

export type FormState = { error?: string; ok?: string } | null;

const itemSchema = z.object({
  orderItemId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().min(0.001, "退货数量必须大于 0").max(9_999_999.999),
  unitPrice: z.coerce.number().min(0).max(9_999_999_999.99),
});

const createSchema = z.object({
  saleOrderId: z.coerce.number().int().positive(),
  items: z.array(itemSchema).min(1, "请至少添加一行退货商品"),
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function createSaleReturnAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };
  if (user.role === "boss") return { error: "无退货开单权限" };

  const items: unknown[] = [];
  let i = 0;
  while (formData.has(`item_${i}_orderItemId`)) {
    items.push({
      orderItemId: formData.get(`item_${i}_orderItemId`),
      quantity: formData.get(`item_${i}_quantity`),
      unitPrice: formData.get(`item_${i}_unitPrice`),
    });
    i++;
  }
  const parsed = createSchema.safeParse({
    saleOrderId: formData.get("saleOrderId"),
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  const { saleOrderId } = parsed.data;

  const order = await prisma.saleOrder.findUnique({
    where: { id: saleOrderId },
    include: {
      items: true,
      returns: { where: { status: "confirmed" }, include: { items: true } },
    },
  });
  if (!order) return { error: "售卖单不存在" };
  if (order.status !== "confirmed") return { error: "仅已开单的售卖单可退货" };
  if (user.role === "sales" && order.operatorId !== user.id) {
    return { error: "只能对自己开的售卖单退货" };
  }

  const returnedByItem = new Map<number, number>();
  for (const r of order.returns) {
    for (const rItem of r.items) {
      returnedByItem.set(
        rItem.saleOrderItemId,
        (returnedByItem.get(rItem.saleOrderItemId) ?? 0) + Number(rItem.quantity)
      );
    }
  }

  interface Row {
    orderItemId: number;
    quantity: number;
    unitPrice: number;
    productId: number;
    unitId: number;
    costSnapshotPrice: number; // 按原单成本快照回补
  }
  const rows: Row[] = [];
  for (const it of parsed.data.items) {
    const row = order.items.find((oi) => oi.id === Number(it.orderItemId));
    if (!row) return { error: "退货行与原单不匹配" };
    const remaining = Number(row.quantity) - (returnedByItem.get(row.id) ?? 0);
    const qty = Number(it.quantity);
    if (qty > remaining) return { error: `该商品可退数量 ${remaining}，本次 ${qty} 超限` };
    rows.push({
      orderItemId: row.id,
      quantity: qty,
      unitPrice: round2(Number(it.unitPrice)),
      productId: row.productId,
      unitId: row.unitId,
      costSnapshotPrice: Number(row.costAmount) / Number(row.quantity), // 快照均价
    });
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const srRows = await tx.saleReturn.findMany({
          where: { orderNo: { startsWith: `${ORDER_NO_PREFIXES.PRS}${todayCompact()}-` } },
          select: { orderNo: true },
        });
        let maxSeq = 0;
        for (const r of srRows) {
          const seq = Number(/-(\d{4})$/.exec(r.orderNo)?.[1] ?? 0);
          if (seq > maxSeq) maxSeq = seq;
        }
        const orderNo = buildOrderNo(ORDER_NO_PREFIXES.PRS, maxSeq + 1);

        const ret = await tx.saleReturn.create({
          data: {
            orderNo,
            saleOrderId,
            customerId: order.customerId,
            totalAmount: 0,
            operatorId: user.id,
          },
          select: { id: true },
        });
        let total = 0;
        for (const row of rows) {
          const product = await tx.product.findUnique({
            where: { id: row.productId },
            select: { stockQty: true, stockAmount: true, avgCost: true },
          });
          if (!product) throw new Error(`商品 #${row.productId} 不存在`);
          const before = { qty: Number(product.stockQty), amount: Number(product.stockAmount), avgCost: Number(product.avgCost) };
          // 退货入库：成本按原单成本快照均价回补（文档 3.5）
          const next = applyStockChange(before, row.quantity, row.costSnapshotPrice);
          await tx.product.update({
            where: { id: row.productId },
            data: { stockQty: next.qty, stockAmount: next.amount, avgCost: next.avgCost },
          });
          await tx.stockMovement.create({
            data: {
              productId: row.productId,
              changeQty: row.quantity,
              beforeQty: before.qty,
              afterQty: next.qty,
              unitCost: row.costSnapshotPrice,
              bizType: "sale_return_in",
              bizOrderNo: orderNo,
              operatorId: user.id,
            },
          });
          const amount = round2(row.quantity * row.unitPrice);
          total += amount;
          await tx.saleReturnItem.create({
            data: {
              saleReturnId: ret.id,
              saleOrderItemId: row.orderItemId,
              productId: row.productId,
              quantity: row.quantity,
              unitId: row.unitId,
              unitPrice: row.unitPrice,
              amount,
              costAmount: round2(row.quantity * row.costSnapshotPrice),
            },
          });
        }
        await tx.saleReturn.update({ where: { id: ret.id }, data: { totalAmount: round2(total) } });
        return { id: ret.id, orderNo, totalAmount: round2(total) };
      });
      await writeAudit({
        userId: user.id,
        action: "create",
        entityType: "sale_return",
        entityId: result.id,
        after: { orderNo: result.orderNo, saleOrderId, totalAmount: result.totalAmount },
      });
      revalidatePath("/sale-returns");
      revalidatePath(`/sale-orders/${saleOrderId}`);
      redirect(`/sale-returns?created=${result.orderNo}`);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT")) throw err;
      console.error("[sale-return] 创建失败:", err);
      return { error: err instanceof Error ? err.message : "退货开单失败，请重试" };
    }
  }
  return { error: "单据号生成失败，请重试" };
}

/** 作废销售退货单：库存减回、应收恢复（概览口径动态计算） */
export async function voidSaleReturnAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };
  if (user.role === "sales") return { error: "业务员无作废权限" };

  const id = Number(formData.get("id"));
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  if (!reason) return { error: "请填写作废原因" };

  const ret = await prisma.saleReturn.findUnique({ where: { id }, include: { items: true } });
  if (!ret) return { error: "退货单不存在" };
  if (ret.status === "voided") return { error: "退货单已作废" };

  try {
    await prisma.$transaction(async (tx) => {
      for (const item of ret.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { stockQty: true, stockAmount: true, avgCost: true },
        });
        if (!product) throw new Error(`商品 #${item.productId} 不存在`);
        const before = { qty: Number(product.stockQty), amount: Number(product.stockAmount), avgCost: Number(product.avgCost) };
        if (before.qty < Number(item.quantity)) {
          throw new Error(`商品 #${item.productId} 库存不足（${before.qty} < ${Number(item.quantity)}），无法撤销退货`);
        }
        const next = applyStockChange(before, -Number(item.quantity), before.avgCost);
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQty: next.qty, stockAmount: next.amount, avgCost: next.avgCost },
        });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            changeQty: -Number(item.quantity),
            beforeQty: before.qty,
            afterQty: next.qty,
            unitCost: before.avgCost,
            bizType: "void_reverse",
            bizOrderNo: ret.orderNo,
            operatorId: user.id,
          },
        });
      }
      await tx.saleReturn.update({
        where: { id },
        data: { status: "voided", voidedBy: user.id, voidedAt: new Date(), voidReason: reason },
      });
    });
    await writeAudit({
      userId: user.id,
      action: "void",
      entityType: "sale_return",
      entityId: id,
      before: { orderNo: ret.orderNo, status: ret.status },
      after: { orderNo: ret.orderNo, status: "voided", voidReason: reason },
    });
    revalidatePath("/sale-returns");
    return { ok: "已作废，库存已减回" };
  } catch (err) {
    console.error("[sale-return] 作废失败:", err);
    return { error: err instanceof Error ? err.message : "作废失败，请重试" };
  }
}
