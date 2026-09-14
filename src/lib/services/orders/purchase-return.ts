import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditIp, writeAudit } from "@/lib/audit";
import { applyStockChange } from "@/lib/stock-cost";
import { buildOrderNo, nextOrderSeq, ORDER_NO_PREFIXES } from "@/lib/order-no";
import { requiredNumber } from "@/lib/form-number";
import { runInTransaction } from "@/lib/services/dry-run";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 进货退货（服务层；网页 action 与 CLI 共用）。
 *
 * 口径照抄 src/app/(main)/purchase-returns/actions.ts，改动必须同步改页面：
 * - 货退回厂家 → 库存**减少**，按**当前移动加权均价**出库（进货侧没有"快照价"可用，
 *   这一点与售卖退货不同：那边是按原单快照均价回补）
 * - 出库前必须校验**当前库存充足**（防负库存）
 * - 只有 `received`（已入库）的进货单可退；可退数量 = 原行数量 − 已退累计
 * - 应付同样是读取时动态冲减，不写回原单
 * - 业务员只能退自己开的单；老板无退货开单权限
 *
 * 取号显式指定 `purchaseReturn` 表：原来这段在每个模块各抄一份，
 * 而进货退货那份**抄成了 purchaseOrder 表**，导致当天第二张必然撞唯一键（P0-2）。
 * 现在 nextOrderSeq 要求调用方把"查哪张表"写出来，传错在类型上一眼可见。
 */

const itemSchema = z.object({
  orderItemId: z.coerce.number().int().positive(),
  quantity: requiredNumber({
    invalid: "请填写退货数量",
    min: 0.001,
    minMessage: "退货数量必须大于 0（不退货的行留空即可）",
    max: 9_999_999.999,
    maxMessage: "退货数量过大",
  }),
  unitPrice: requiredNumber({ invalid: "请填写退货单价", min: 0, max: 9_999_999_999.99, maxMessage: "退货单价格式不正确" }),
});

const createSchema = z.object({
  purchaseOrderId: z.coerce.number().int().positive("请指定原进货单 --order-id"),
  items: z.array(itemSchema).min(1, "请至少指定一行退货（quantity 留空/0 的行会被跳过）"),
});

export type CreatePurchaseReturnInput = z.input<typeof createSchema>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toFixed(2);
const qty = (n: number) => n.toFixed(3);

export async function createPurchaseReturn(
  actor: Actor,
  rawInput: CreatePurchaseReturnInput,
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role === "boss") return fail("FORBIDDEN", "无退货开单权限");
  const parsed = createSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "输入有误");
  const { purchaseOrderId, items } = parsed.data;

  const order = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: {
      items: true,
      returns: { where: { status: "confirmed" }, include: { items: true } },
      supplier: { select: { name: true } },
    },
  });
  if (!order) return fail("NOT_FOUND", `进货单不存在：#${purchaseOrderId}`);
  if (order.status !== "received") {
    return fail("RULE", `仅已入库的进货单可退货（本单当前状态：${order.status === "pending" ? "待收货" : "已作废"}）`);
  }
  if (actor.role === "sales" && order.operatorId !== actor.userId) {
    return fail("FORBIDDEN", "只能对自己开的进货单退货");
  }

  const returnedByItem = new Map<number, number>();
  for (const r of order.returns) {
    for (const rItem of r.items) {
      returnedByItem.set(rItem.purchaseOrderItemId, (returnedByItem.get(rItem.purchaseOrderItemId) ?? 0) + Number(rItem.quantity));
    }
  }

  const rows: { orderItemId: number; quantity: number; unitPrice: number; productId: number; unitId: number }[] = [];
  for (const it of items) {
    const row = order.items.find((oi) => oi.id === Number(it.orderItemId));
    if (!row) return fail("INVALID", `退货行 #${it.orderItemId} 与原单不匹配`);
    const remaining = Number(row.quantity) - (returnedByItem.get(row.id) ?? 0);
    if (Number(it.quantity) > remaining) {
      return fail("RULE", `原单行 #${row.id} 可退数量 ${qty(remaining)}，本次 ${qty(Number(it.quantity))} 超限`);
    }
    // 退出的货必须有库存（防负库存）
    const product = await prisma.product.findUnique({ where: { id: row.productId }, select: { stockQty: true } });
    if (!product) return fail("INVALID", `商品 #${row.productId} 不存在`);
    if (Number(product.stockQty) < Number(it.quantity)) {
      return fail("RULE", `商品 #${row.productId} 当前库存 ${qty(Number(product.stockQty))}，不足退货 ${qty(Number(it.quantity))}，请先补货`);
    }
    rows.push({
      orderItemId: row.id,
      quantity: Number(it.quantity),
      unitPrice: round2(Number(it.unitPrice)),
      productId: row.productId,
      unitId: row.unitId,
    });
  }

  try {
    const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
      const orderNo = buildOrderNo(
        ORDER_NO_PREFIXES.PRF,
        // 显式指定查 purchaseReturn 表（P0-2 就是这里抄成了 purchaseOrder）
        await nextOrderSeq(ORDER_NO_PREFIXES.PRF, (like) =>
          tx.purchaseReturn.findMany({ where: { orderNo: { startsWith: like } }, select: { orderNo: true } })
        )
      );
      const ret = await tx.purchaseReturn.create({
        data: { orderNo, purchaseOrderId, supplierId: order.supplierId, totalAmount: 0, operatorId: actor.userId },
        select: { id: true },
      });

      const lines = [];
      let total = 0;
      for (const row of rows) {
        const product = await tx.product.findUnique({
          where: { id: row.productId },
          select: { stockQty: true, stockAmount: true, avgCost: true },
        });
        if (!product) throw new Error(`商品 #${row.productId} 不存在`);
        const before = { qty: Number(product.stockQty), amount: Number(product.stockAmount), avgCost: Number(product.avgCost) };
        const next = applyStockChange(before, -row.quantity, before.avgCost);
        await tx.product.update({
          where: { id: row.productId },
          data: { stockQty: next.qty, stockAmount: next.amount, avgCost: next.avgCost },
        });
        await tx.stockMovement.create({
          data: {
            productId: row.productId,
            changeQty: -row.quantity,
            beforeQty: before.qty,
            afterQty: next.qty,
            unitCost: before.avgCost,
            bizType: "purchase_return_out",
            bizOrderNo: orderNo,
            operatorId: actor.userId,
          },
        });
        const amount = round2(row.quantity * row.unitPrice);
        total += amount;
        await tx.purchaseReturnItem.create({
          data: {
            purchaseReturnId: ret.id,
            purchaseOrderItemId: row.orderItemId,
            productId: row.productId,
            quantity: row.quantity,
            unitId: row.unitId,
            unitPrice: row.unitPrice,
            amount,
          },
        });
        lines.push({
          原单行: row.orderItemId,
          退货数量: qty(row.quantity),
          退货价: money(row.unitPrice),
          按当前均价出库: money(before.avgCost),
          库存变化: `${qty(before.qty)} → ${qty(next.qty)}`,
        });
      }
      await tx.purchaseReturn.update({ where: { id: ret.id }, data: { totalAmount: round2(total) } });

      await writeAudit({
        userId: actor.userId,
        action: "create",
        entityType: "purchase_return",
        entityId: ret.id,
        tx,
        ip: auditIp(actor),
        after: {
          orderNo,
          purchaseOrderId,
          totalAmount: round2(total),
          source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web",
          runId: actor.runId ?? null,
        },
      });

      return {
        退货单: orderNo,
        原进货单: order.orderNo,
        厂家: order.supplier.name,
        冲减应付: money(round2(total)),
        行: lines,
        说明: "出库按当前移动加权均价；应付是读取时动态冲减，不写回原单",
      };
    });
    return ok({ committed, dryRun: !committed, ...(committed ? {} : { 说明: "这是预演，什么都没写。确认后加 --yes" }), plan });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return fail("CONFLICT", "退货单号冲突（并发），请重试");
    }
    console.error("[purchase-return.create] 失败:", e);
    return fail("INTERNAL", e instanceof Error ? e.message : "退货开单失败");
  }
}

export async function voidPurchaseReturn(
  actor: Actor,
  rawInput: { id: number; reason: string },
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role === "sales") return fail("FORBIDDEN", "业务员无作废权限");
  const parsed = z
    .object({ id: z.coerce.number().int().positive("请指定退货单 --id"), reason: z.string().trim().min(1, "请填写作废原因").max(200) })
    .safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const { id, reason } = parsed.data;

  const ret = await prisma.purchaseReturn.findUnique({ where: { id }, include: { items: true } });
  if (!ret) return fail("NOT_FOUND", `退货单不存在：#${id}`);
  if (ret.status === "voided") return fail("RULE", `退货单 ${ret.orderNo} 已作废`);

  const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
    const lines = [];
    for (const item of ret.items) {
      const product = await tx.product.findUnique({
        where: { id: item.productId },
        select: { stockQty: true, stockAmount: true, avgCost: true },
      });
      if (!product) throw new Error(`商品 #${item.productId} 不存在`);
      const before = { qty: Number(product.stockQty), amount: Number(product.stockAmount), avgCost: Number(product.avgCost) };
      const next = applyStockChange(before, Number(item.quantity), before.avgCost);
      await tx.product.update({
        where: { id: item.productId },
        data: { stockQty: next.qty, stockAmount: next.amount, avgCost: next.avgCost },
      });
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          changeQty: Number(item.quantity),
          beforeQty: before.qty,
          afterQty: next.qty,
          unitCost: before.avgCost,
          bizType: "void_reverse",
          bizOrderNo: ret.orderNo,
          operatorId: actor.userId,
        },
      });
      lines.push({ 行: item.purchaseOrderItemId, 处理: "库存加回", 变化: `${qty(before.qty)} → ${qty(next.qty)}` });
    }
    await tx.purchaseReturn.update({
      where: { id },
      data: { status: "voided", voidedBy: actor.userId, voidedAt: new Date(), voidReason: reason },
    });
    await writeAudit({
      userId: actor.userId,
      action: "void",
      entityType: "purchase_return",
      entityId: id,
      tx,
      ip: auditIp(actor),
      before: { orderNo: ret.orderNo, status: ret.status },
      after: { orderNo: ret.orderNo, status: "voided", voidReason: reason, source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web", runId: actor.runId ?? null },
    });
    return { 退货单: ret.orderNo, 操作: "作废", 行: lines, 说明: "已作废，库存已加回" };
  });
  return ok({ committed, dryRun: !committed, ...(committed ? {} : { 说明: "这是预演，什么都没写。确认后加 --yes" }), plan });
}
