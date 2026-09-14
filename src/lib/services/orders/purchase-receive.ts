import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditIp, auditProvenance, writeAudit } from "@/lib/audit";
import { applyStockChange } from "@/lib/stock-cost";
import { runInTransaction } from "@/lib/services/dry-run";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 确认入库（服务层；网页 action 与 CLI 共用）。
 *
 * **这是库存真正进来的唯一入口**，也是移动加权成本被重算的地方，所以照抄
 * src/app/(main)/purchase-orders/actions.ts 时格外小心，语义一字不改：
 *
 *   next = applyStockChange(入库前, +本行数量, 本行进价)
 *   新金额 = 原金额 + 数量 × 进价；新均价 = 新金额 ÷ 新数量
 *
 * 出库/冲回用的是**当时**的均价，而入库用的是**本单进价**——所以入库会改写均价，
 * 这也正是"成本快照不能回溯改"的原因（改了历史单据会让后续成本全错）。
 *
 * 权限（与网页一致）：老板/财务无入库权限；业务员只能操作自己开的进货单。
 * 判定在服务层——CLI 不经过 action。
 *
 * dry-run 会把"入库前后"的数量/金额/均价逐行列出来：这是 Agent 最需要看的预告
 * （它要据此判断"这批货入库后均价会变成多少"）。
 */

const schema = z.object({ id: z.coerce.number().int().positive("请指定单据 --id") });

const money = (n: number) => n.toFixed(2);
const qty = (n: number) => n.toFixed(3);
const avg = (n: number) => n.toFixed(4);

export async function receivePurchaseOrder(
  actor: Actor,
  rawInput: { id: number },
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role === "boss") return fail("FORBIDDEN", "无确认入库权限");
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const { id } = parsed.data;

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: { include: { product: { select: { code: true, name: true } } } } },
  });
  if (!order) return fail("NOT_FOUND", `进货单不存在：#${id}`);
  if (order.status !== "pending") {
    return fail("RULE", `仅待收货单据可入库（本单当前状态：${order.status === "received" ? "已入库" : "已作废"}）`);
  }
  if (actor.role === "sales" && order.operatorId !== actor.userId) {
    return fail("FORBIDDEN", "只能操作自己开的进货单");
  }

  try {
    const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
      const lines = [];
      for (const item of order.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { stockQty: true, stockAmount: true, avgCost: true },
        });
        if (!product) throw new Error(`商品 #${item.productId} 不存在`);
        const before = { qty: Number(product.stockQty), amount: Number(product.stockAmount), avgCost: Number(product.avgCost) };
        const next = applyStockChange(before, Number(item.quantity), Number(item.unitPrice));
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
            unitCost: Number(item.unitPrice),
            bizType: "purchase_in",
            bizOrderNo: order.orderNo,
            operatorId: actor.userId,
          },
        });
        lines.push({
          商品: `${item.product.code} ${item.product.name}`,
          入库数量: qty(Number(item.quantity)),
          进价: money(Number(item.unitPrice)),
          入库前: `数量 ${qty(before.qty)} / 金额 ${money(before.amount)} / 均价 ${avg(before.avgCost)}`,
          入库后: `数量 ${qty(next.qty)} / 金额 ${money(next.amount)} / 均价 ${avg(next.avgCost)}`,
        });
      }
      await tx.purchaseOrder.update({ where: { id }, data: { status: "received", receivedAt: new Date() } });
      await writeAudit({
        userId: actor.userId,
        action: "receive",
        entityType: "purchase_order",
        entityId: id,
        tx,
        ip: auditIp(actor),
        ...auditProvenance(actor),
        before: { orderNo: order.orderNo, status: order.status },
        after: {
          orderNo: order.orderNo,
          status: "received",
          source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web",
          runId: actor.runId ?? null,
        },
      });
      return {
        单据: order.orderNo,
        状态变化: "pending → received",
        行: lines,
        说明: "入库已按本单进价重算移动加权均价；库存流水类型 purchase_in",
      };
    });
    return ok({ committed, dryRun: !committed, ...(committed ? {} : { 说明: "这是预演，什么都没写。确认后加 --yes" }), plan });
  } catch (e) {
    console.error("[purchase-order.receive] 失败:", e);
    return fail("RULE", e instanceof Error ? e.message : "入库失败");
  }
}
