"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, type TxClient } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { applyStockChange } from "@/lib/stock-cost";
import { buildOrderNo, ORDER_NO_PREFIXES, todayCompact } from "@/lib/order-no";
import { firstIssueMessage, requiredNumber } from "@/lib/form-number";

export type FormState = { error?: string; ok?: string } | null;

const itemSchema = z.object({
  productId: z.coerce.number().int().positive("请选择商品"),
  quantity: requiredNumber({
    invalid: "请填写数量",
    min: 0.001,
    minMessage: "数量必须大于 0",
    max: 9_999_999.999,
    maxMessage: "数量过大",
  }),
  unitPrice: requiredNumber({
    invalid: "请填写进价",
    min: 0,
    max: 9_999_999_999.99,
    maxMessage: "进价格式不正确",
  }),
  remark: z.string().trim().max(200).optional().default(""), // 行备注
});

const createSchema = z.object({
  supplierId: z.coerce.number().int().positive("请选择厂家"),
  remark: z.string().trim().max(200),
  items: z.array(itemSchema).min(1, "请至少添加一行商品"),
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function requirePurchaseWrite() {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");
  if (user.role === "boss") throw new Error("老板/财务无进货开单权限");
  return user;
}

function parseCreatePayload(formData: FormData) {
  const items: unknown[] = [];
  let i = 0;
  while (formData.has(`item_${i}_productId`)) {
    // 未选择商品的空行直接跳过
    if (!String(formData.get(`item_${i}_productId`) || "").trim()) {
      i++;
      continue;
    }
    items.push({
      productId: formData.get(`item_${i}_productId`),
      quantity: formData.get(`item_${i}_quantity`),
      unitPrice: formData.get(`item_${i}_unitPrice`),
      remark: formData.get(`item_${i}_remark`) || "",
    });
    i++;
  }
  return createSchema.safeParse({
    supplierId: formData.get("supplierId"),
    remark: formData.get("remark") ?? "",
    items,
  });
}

/** 当日序号：同前缀单据最大序号 + 1；唯一索引冲突时重试（并发防重号）。 */
async function nextSeq(tx: TxClient, prefix: string): Promise<number> {
  const rows = await tx.purchaseOrder.findMany({
    where: { orderNo: { startsWith: `${prefix}${todayCompact()}-` } },
    select: { orderNo: true },
  });
  let maxSeq = 0;
  for (const r of rows) {
    const seq = Number(/-(\d{4})$/.exec(r.orderNo)?.[1] ?? 0);
    if (seq > maxSeq) maxSeq = seq;
  }
  return maxSeq + 1;
}

export async function createPurchaseOrderAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requirePurchaseWrite();
  const parsed = parseCreatePayload(formData);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error, { unitPrice: "进价" }) };
  }
  const { supplierId, remark, items } = parsed.data;
  // 开单时就能标星（表单厂家信息区里那个星按钮）
  const starred = formData.get("starred") === "1";

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier || supplier.status !== 1) return { error: "厂家不存在或已停用" };

  const productIds = [...new Set(items.map((it) => it.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, status: true, unitId: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));
  for (const p of products) {
    if (p.status !== 1) return { error: `商品 #${p.id} 已停用，无法开单` };
  }

  const normalized = items.map((it) => {
    const product = productMap.get(it.productId);
    if (!product) throw new Error(`商品 #${it.productId} 不存在`);
    return {
      productId: it.productId,
      unitId: product.unitId, // 单位取商品默认单位（文档：不做换算，单单位制）
      quantity: Math.round(it.quantity * 1000) / 1000,
      unitPrice: round2(it.unitPrice),
      remark: it.remark || null,
    };
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await prisma.$transaction(async (tx) => {
        const seq = await nextSeq(tx, ORDER_NO_PREFIXES.PO);
        const no = buildOrderNo(ORDER_NO_PREFIXES.PO, seq);
        const itemsWithAmount = normalized.map((it) => ({
          ...it,
          amount: round2(it.quantity * it.unitPrice),
        }));
        const created = await tx.purchaseOrder.create({
          data: {
            orderNo: no,
            supplierId,
            status: "pending",
            sourceType: "manual",
            starred,
            totalAmount: round2(itemsWithAmount.reduce((s, it) => s + it.amount, 0)),
            remark: remark || null,
            operatorId: user.id,
            items: { create: itemsWithAmount.map((it) => ({ ...it })) },
          },
          select: { id: true, orderNo: true, totalAmount: true },
        });
        await writeAudit({
          userId: user.id,
          action: "create",
          entityType: "purchase_order",
          entityId: created.id,
          // tx：与建单同事务。以前走全局 prisma，P2002 重试时同一次创建会写多条审计
          tx,
          after: { orderNo: created.orderNo, supplierId, totalAmount: Number(created.totalAmount) },
        });
        return created;
      });
      revalidatePath("/purchase-orders");
      redirect("/purchase-orders");
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        continue; // 序号冲突，重取
      }
      if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT")) {
        throw err; // redirect 异常放行
      }
      console.error("[purchase] 开单失败:", err);
      return { error: "开单失败，请重试" };
    }
  }
  return { error: "单据号生成失败，请重试" };
}

export async function receivePurchaseOrderAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };
  if (user.role === "boss") return { error: "无确认入库权限" };

  const id = Number(formData.get("id"));
  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: { include: { product: true } } },
  });
  if (!order) return { error: "进货单不存在" };
  if (order.status !== "pending") return { error: "仅待收货单据可入库" };
  if (user.role === "sales" && order.operatorId !== user.id) {
    return { error: "只能操作自己开的进货单" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { stockQty: true, stockAmount: true, avgCost: true },
        });
        if (!product) throw new Error(`商品 #${item.productId} 不存在`);
        const before = {
          qty: Number(product.stockQty),
          amount: Number(product.stockAmount),
          avgCost: Number(product.avgCost),
        };
        const next = applyStockChange(before, Number(item.quantity), Number(item.unitPrice));
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stockQty: next.qty,
            stockAmount: next.amount,
            avgCost: next.avgCost,
          },
        });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            changeQty: Number(item.quantity),
            beforeQty: before.qty,
            afterQty: next.qty,
            unitCost: Number(item.unitPrice),
            bizType: "purchase_in",
            bizOrderNo: order.orderNo,
            operatorId: user.id,
          },
        });
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: "received", receivedAt: new Date() },
      });
    });
    await writeAudit({
      userId: user.id,
      action: "receive",
      entityType: "purchase_order",
      entityId: id,
      before: { orderNo: order.orderNo, status: order.status },
      after: { orderNo: order.orderNo, status: "received" },
    });
    revalidatePath(`/purchase-orders/${id}`);
    revalidatePath("/purchase-orders");
    return { ok: "已确认入库，库存已增加" };
  } catch (err) {
    console.error("[purchase] 入库失败:", err);
    return { error: err instanceof Error ? err.message : "入库失败，请重试" };
  }
}

export async function voidPurchaseOrderAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };
  // 矩阵：进货单作废仅管理员/老板
  if (user.role === "sales") return { error: "业务员无作废权限" };

  const id = Number(formData.get("id"));
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  if (!reason) return { error: "请填写作废原因" };

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!order) return { error: "进货单不存在" };
  if (order.status === "voided") return { error: "单据已作废" };
  if (order.status === "pending") {
    await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: "voided",
        voidedBy: user.id,
        voidedAt: new Date(),
        voidReason: reason,
      },
    });
    await writeAudit({
      userId: user.id,
      action: "void",
      entityType: "purchase_order",
      entityId: id,
      before: { orderNo: order.orderNo, status: order.status },
      after: { orderNo: order.orderNo, status: "voided", voidReason: reason },
    });
    revalidatePath(`/purchase-orders/${id}`);
    revalidatePath("/purchase-orders");
    return { ok: "已作废（未入库，无库存影响）" };
  }

  // 已入库单：先校验可冲回（库存未被消耗），再冲回库存 + 反向流水
  for (const item of order.items) {
    const product = await prisma.product.findUnique({
      where: { id: item.productId },
      select: { stockQty: true, stockAmount: true, avgCost: true },
    });
    if (!product) throw new Error("商品不存在");
    const available = Number(product.stockQty);
    if (available < Number(item.quantity)) {
      return {
        error: `商品 ${item.productId} 当前库存 ${available} < 本单数量 ${item.quantity}，库存已被消耗，无法直接作废；请改用【进货退货】`,
      };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { stockQty: true, stockAmount: true, avgCost: true },
        });
        if (!product) throw new Error(`商品 #${item.productId} 不存在`);
        const before = {
          qty: Number(product.stockQty),
          amount: Number(product.stockAmount),
          avgCost: Number(product.avgCost),
        };
        // 冲回按当前移动加权均价计价（与账本水池一致，修正批次口径差异）
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
            bizOrderNo: order.orderNo,
            operatorId: user.id,
          },
        });
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: "voided", voidedBy: user.id, voidedAt: new Date(), voidReason: reason },
      });
    });
    await writeAudit({
      userId: user.id,
      action: "void",
      entityType: "purchase_order",
      entityId: id,
      before: { orderNo: order.orderNo, status: order.status },
      after: { orderNo: order.orderNo, status: "voided", voidReason: reason, stockReversed: true },
    });
    revalidatePath(`/purchase-orders/${id}`);
    revalidatePath("/purchase-orders");
    return { ok: "已作废，库存已冲回" };
  } catch (err) {
    console.error("[purchase] 作废失败:", err);
    return { error: err instanceof Error ? err.message : "作废失败，请重试" };
  }
}

/**
 * 星标开关（列表行与详情页共用）。
 * 不是财务操作，不做二次确认；业务员只能标自己开的单（与退货同口径）。
 */
export async function togglePurchaseOrderStarAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const id = Number(formData.get("id"));
  const starred = formData.get("starred") === "1";
  if (!Number.isInteger(id) || id <= 0) return;

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { id: true, operatorId: true, starred: true },
  });
  if (!order || order.starred === starred) return;
  if (user.role === "sales" && order.operatorId !== user.id) return;

  await prisma.purchaseOrder.update({ where: { id }, data: { starred } });
  await writeAudit({
    userId: user.id,
    action: "update",
    entityType: "purchase_order",
    entityId: id,
    before: { starred: order.starred },
    after: { starred },
  });
  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${id}`);
}
