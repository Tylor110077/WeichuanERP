"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { buildOrderNo, ORDER_NO_PREFIXES, todayCompact } from "@/lib/order-no";
import { requiredNumber } from "@/lib/form-number";

export type FillState = { error?: string; ok?: string } | null;

const schema = z.object({
  itemId: z.coerce.number().int().positive(),
  supplierId: z.coerce.number().int().positive("请选择厂家"),
  unitPrice: requiredNumber({
    invalid: "请填写进价",
    min: 0,
    max: 9_999_999_999.99,
    maxMessage: "进价格式不正确",
  }).refine((v) => v > 0, "进价必须大于 0"),
  productName: z.string().trim().max(100),
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 估价待补：把一行的真实进价与货源补上。
 *
 * 做三件事（同一个事务里）：
 * 1. 生成一张**待收货**的进货单（挂到触发它的售卖单上，这样售卖单作废时会一并作废）；
 * 2. 把成本写回原售卖单的那一行（成本快照 = 数量 × 进价）；
 * 3. 如果开单时用的是临时商品名/没有厂家，顺手把商品档案补正、并记下厂家。
 *
 * 为什么补成本是安全的：估价行不消耗库存、也没参与移动加权成本，
 * 所以写回只影响这一张单自己的毛利，不会牵动其它单据。
 * 库存要等这张进货单「确认入库」才进——那一步仍走既有的入库逻辑。
 */
export async function fillEstimatedAction(_prev: FillState, formData: FormData): Promise<FillState> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { error: "仅管理员可补单" };

  const parsed = schema.safeParse({
    itemId: formData.get("itemId"),
    supplierId: formData.get("supplierId"),
    unitPrice: formData.get("unitPrice"),
    productName: formData.get("productName") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  const { itemId, supplierId, unitPrice, productName } = parsed.data;

  const item = await prisma.saleOrderItem.findUnique({
    where: { id: itemId },
    include: {
      product: { select: { id: true, code: true, name: true, unitId: true, manufacturer: true } },
      saleOrder: { select: { id: true, orderNo: true, status: true } },
    },
  });
  if (!item) return { error: "找不到这一行" };
  if (!item.estimated) return { error: "这一行不是估价行" };
  if (item.estimatedResolvedAt) return { error: "这一行已经补过了" };
  if (item.saleOrder.status !== "confirmed") return { error: "原售卖单已作废，无需补单" };

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } });
  if (!supplier) return { error: "厂家不存在" };

  const qty = Number(item.quantity);
  const costAmount = round2(qty * unitPrice);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // 进货单号：与手工开单同一套（PO + 日期 + 当日序号）
        const rows = await tx.purchaseOrder.findMany({
          where: { orderNo: { startsWith: `${ORDER_NO_PREFIXES.PO}${todayCompact()}-` } },
          select: { orderNo: true },
        });
        let maxSeq = 0;
        for (const r of rows) {
          const seq = Number(/-(\d{4})$/.exec(r.orderNo)?.[1] ?? 0);
          if (seq > maxSeq) maxSeq = seq;
        }

        const po = await tx.purchaseOrder.create({
          data: {
            orderNo: buildOrderNo(ORDER_NO_PREFIXES.PO, maxSeq + 1),
            supplierId,
            status: "pending", // 货到了在进货单里点「确认入库」，库存那一步仍走既有逻辑
            sourceType: "auto",
            sourceSaleOrderId: item.saleOrder.id,
            totalAmount: costAmount,
            remark: `估价补单（原单 ${item.saleOrder.orderNo}）`,
            operatorId: admin.id,
            items: {
              create: [
                {
                  productId: item.productId,
                  unitId: item.product.unitId,
                  quantity: qty,
                  unitPrice,
                  amount: costAmount,
                  restockQty: qty, // 这批货是给这张售卖单备的
                },
              ],
            },
          },
          select: { id: true, orderNo: true },
        });

        // 成本写回原行（估价行没参与过移动加权成本，写回只影响本单毛利）
        await tx.saleOrderItem.update({
          where: { id: itemId },
          data: { costAmount, estimatedResolvedAt: new Date(), estimatedPurchaseOrderId: po.id },
        });

        // 临时名/没厂家的商品档案顺手补正
        const patch: { name?: string; manufacturer?: string } = {};
        if (productName && productName !== item.product.name) patch.name = productName;
        if (supplier.name && supplier.name !== item.product.manufacturer) patch.manufacturer = supplier.name;
        if (Object.keys(patch).length > 0) {
          await tx.product.update({ where: { id: item.productId }, data: patch });
        }

        return po;
      });

      await writeAudit({
        userId: admin.id,
        action: "update",
        entityType: "sale_order_item",
        entityId: itemId,
        before: { estimated: true, costAmount: Number(item.costAmount) },
        after: {
          补单进货单: result.orderNo,
          supplierId,
          unitPrice,
          costAmount,
          商品改名: productName || undefined,
        },
      });
      revalidatePath("/pending-estimates");
      revalidatePath("/purchase-orders");
      revalidatePath(`/sale-orders/${item.saleOrder.id}`);
      return { ok: `已生成进货单 ${result.orderNo}（待收货），成本 ¥${costAmount.toFixed(2)} 已写回本行` };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      console.error("[pending-estimates] 补单失败:", err);
      return { error: err instanceof Error ? err.message : "补单失败，请重试" };
    }
  }
  return { error: "单号冲突，请重试" };
}
