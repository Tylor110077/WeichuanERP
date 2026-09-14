import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditIp, auditProvenance, writeAudit } from "@/lib/audit";
import { applyStockChange } from "@/lib/stock-cost";
import { buildOrderNo, nextOrderSeq, ORDER_NO_PREFIXES } from "@/lib/order-no";
import { requiredNumber } from "@/lib/form-number";
import { runInTransaction } from "@/lib/services/dry-run";
import { provenanceFor } from "@/lib/services/provenance";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 售卖退货（服务层；网页 action 与 CLI 共用）。
 *
 * 口径照抄 src/app/(main)/sale-returns/actions.ts，改动必须同步改页面：
 * - **退货入库的成本按原单快照均价**（`saleOrderItem.costAmount / quantity`）回补，
 *   而不是当前移动加权价——原单卖出去时成本是多少，退回来就按多少入账
 * - **应收不写回原单**，是读取时动态冲减（`单额 − 已收 − Σ未作废退货`）
 * - 可退数量 = 原行数量 − 已确认退货累计；已作废的售卖单不能退
 * - 业务员只能对自己开的售卖单退货；老板/财务无退货开单权限
 *
 * **估价行不入库**（这是本会话修的缺陷，见计划 §13.8 #2）：估价行的货开单时
 * 从没出过库存（`stockQtyUsed = 0`），退回来自然也不该入库——否则会凭空多出库存、
 * 并按 0 成本把移动加权均价拉低；已补单的估价行更糟，货是进货单进来的，退货会再算一遍。
 * 作废退货单时对称跳过（否则会减掉本就没进来过的库存）。
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
  saleOrderId: z.coerce.number().int().positive("请指定原售卖单 --order-id"),
  items: z.array(itemSchema).min(1, "请至少指定一行退货（quantity 留空/0 的行会被跳过）"),
});

export type CreateSaleReturnInput = z.input<typeof createSchema>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toFixed(2);
const qty = (n: number) => n.toFixed(3);

interface ReturnRow {
  orderItemId: number;
  quantity: number;
  unitPrice: number;
  productId: number;
  unitId: number;
  costSnapshotPrice: number;
  estimated: boolean;
}

export async function createSaleReturn(
  actor: Actor,
  rawInput: CreateSaleReturnInput,
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role === "boss") return fail("FORBIDDEN", "无退货开单权限");
  const parsed = createSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "输入有误");
  const { saleOrderId, items } = parsed.data;

  const order = await prisma.saleOrder.findUnique({
    where: { id: saleOrderId },
    include: {
      items: true,
      returns: { where: { status: "confirmed" }, include: { items: true } },
      customer: { select: { name: true } },
    },
  });
  if (!order) return fail("NOT_FOUND", `售卖单不存在：#${saleOrderId}`);
  if (order.status !== "confirmed") return fail("RULE", "仅已开单的售卖单可退货");
  if (actor.role === "sales" && order.operatorId !== actor.userId) {
    return fail("FORBIDDEN", "只能对自己开的售卖单退货");
  }

  // 可退数量 = 原行数量 − 已确认退货累计
  const returnedByItem = new Map<number, number>();
  for (const r of order.returns) {
    for (const rItem of r.items) {
      returnedByItem.set(rItem.saleOrderItemId, (returnedByItem.get(rItem.saleOrderItemId) ?? 0) + Number(rItem.quantity));
    }
  }

  const rows: ReturnRow[] = [];
  for (const it of items) {
    const row = order.items.find((oi) => oi.id === Number(it.orderItemId));
    if (!row) return fail("INVALID", `退货行 #${it.orderItemId} 与原单不匹配`);
    const remaining = Number(row.quantity) - (returnedByItem.get(row.id) ?? 0);
    if (Number(it.quantity) > remaining) {
      return fail("RULE", `原单行 #${row.id} 可退数量 ${qty(remaining)}，本次 ${qty(Number(it.quantity))} 超限`);
    }
    rows.push({
      orderItemId: row.id,
      quantity: Number(it.quantity),
      unitPrice: round2(Number(it.unitPrice)),
      productId: row.productId,
      unitId: row.unitId,
      costSnapshotPrice: Number(row.costAmount) / Number(row.quantity),
      estimated: row.estimated,
    });
  }

  try {
    const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
      const orderNo = buildOrderNo(
        ORDER_NO_PREFIXES.PRS,
        await nextOrderSeq(ORDER_NO_PREFIXES.PRS, (like) =>
          tx.saleReturn.findMany({ where: { orderNo: { startsWith: like } }, select: { orderNo: true } })
        )
      );
      const ret = await tx.saleReturn.create({
        data: { orderNo, saleOrderId, customerId: order.customerId, totalAmount: 0, operatorId: actor.userId, ...provenanceFor(actor) },
        select: { id: true },
      });

      const lines = [];
      let total = 0;
      for (const row of rows) {
        // 估价行跳过全部库存写入（见文件头说明）
        if (!row.estimated) {
          const product = await tx.product.findUnique({
            where: { id: row.productId },
            select: { stockQty: true, stockAmount: true, avgCost: true },
          });
          if (!product) throw new Error(`商品 #${row.productId} 不存在`);
          const before = { qty: Number(product.stockQty), amount: Number(product.stockAmount), avgCost: Number(product.avgCost) };
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
              operatorId: actor.userId,
            },
          });
          lines.push({
            原单行: row.orderItemId,
            退货数量: qty(row.quantity),
            退货价: money(row.unitPrice),
            按快照均价入库: money(row.costSnapshotPrice),
            库存变化: `${qty(before.qty)} → ${qty(next.qty)}`,
          });
        } else {
          lines.push({
            原单行: row.orderItemId,
            退货数量: qty(row.quantity),
            退货价: money(row.unitPrice),
            估价行: "是（不入库：这行开单时就没占库存）",
          });
        }
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

      await writeAudit({
        userId: actor.userId,
        action: "create",
        entityType: "sale_return",
        entityId: ret.id,
        tx,
        ip: auditIp(actor),
        ...auditProvenance(actor),
        after: {
          orderNo,
          saleOrderId,
          totalAmount: round2(total),
          source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web",
          runId: actor.runId ?? null,
        },
      });

      return {
        退货单: orderNo,
        原售卖单: order.orderNo,
        客户: order.customer.name,
        冲减应收: money(round2(total)),
        行: lines,
        说明: "成本按原单快照均价入库；应收是读取时动态冲减，不写回原单",
      };
    });
    return ok({ committed, dryRun: !committed, ...(committed ? {} : { 说明: "这是预演，什么都没写。确认后加 --yes" }), plan });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return fail("CONFLICT", "退货单号冲突（并发），请重试");
    }
    console.error("[sale-return.create] 失败:", e);
    return fail("INTERNAL", e instanceof Error ? e.message : "退货开单失败");
  }
}

export async function voidSaleReturn(
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

  const ret = await prisma.saleReturn.findUnique({ where: { id }, include: { items: true } });
  if (!ret) return fail("NOT_FOUND", `退货单不存在：#${id}`);
  if (ret.status === "voided") return fail("RULE", `退货单 ${ret.orderNo} 已作废`);

  const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
    // 估价行当初没入库，作废时也不能减库存（与创建时对称）
    const originItems = await tx.saleOrderItem.findMany({
      where: { id: { in: ret.items.map((i) => i.saleOrderItemId) } },
      select: { id: true, estimated: true },
    });
    const estimatedItemIds = new Set(originItems.filter((i) => i.estimated).map((i) => i.id));

    const lines = [];
    for (const item of ret.items) {
      if (estimatedItemIds.has(item.saleOrderItemId)) {
        lines.push({ 行: item.saleOrderItemId, 处理: "估价行，跳过库存" });
        continue;
      }
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
          operatorId: actor.userId,
        },
      });
      lines.push({ 行: item.saleOrderItemId, 处理: "库存减回", 变化: `${qty(before.qty)} → ${qty(next.qty)}` });
    }

    await tx.saleReturn.update({
      where: { id },
      data: { status: "voided", voidedBy: actor.userId, voidedAt: new Date(), voidReason: reason },
    });
    await writeAudit({
      userId: actor.userId,
      action: "void",
      entityType: "sale_return",
      entityId: id,
      tx,
      ip: auditIp(actor),
        ...auditProvenance(actor),
      before: { orderNo: ret.orderNo, status: ret.status },
      after: { orderNo: ret.orderNo, status: "voided", voidReason: reason, source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web", runId: actor.runId ?? null },
    });
    return {
      退货单: ret.orderNo,
      操作: "作废",
      行: lines,
      说明: lines.some((l) => l.处理 === "库存减回") ? "已作废，库存已减回" : "已作废（估价行退货本就不涉及库存）",
    };
  });
  return ok({ committed, dryRun: !committed, ...(committed ? {} : { 说明: "这是预演，什么都没写。确认后加 --yes" }), plan });
}
