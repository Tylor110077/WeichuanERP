import { Prisma, type PaymentOrderType } from "@prisma/client";
import { z } from "zod";
import { prisma, type TxClient } from "@/lib/prisma";
import { auditIp, auditProvenance, writeAudit } from "@/lib/audit";
import { buildOrderNo, ORDER_NO_PREFIXES, todayCompact } from "@/lib/order-no";
import { requiredNumber } from "@/lib/form-number";
import { runInTransaction } from "@/lib/services/dry-run";
import { provenanceFor } from "@/lib/services/provenance";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 收付款的写操作服务（网页 action 与 CLI 共用）。
 *
 * 口径照抄 src/app/(main)/receivables-payables/actions.ts，改动必须同步改页面：
 * - **一单一笔**：一笔收付款只核销一张单（多态关联 orderType + orderId，没有外键）
 * - **只能作废不能改**：错了就作废重登，不做 update
 * - 登记时 increment 单据的 received_amount / paid_amount；作废时 decrement
 * - 金额不得超过该单未结清；已作废的单不能再收付
 * - 业务员无权限（与页面一致：admin/boss 可登录即可操作）
 *
 * **本服务补上一处页面没做的校验**（报告 03 §7.3.6 点名的缺口）：
 * `direction` 与 `orderType` 必须配对——收款只能对售卖单、付款只能对进货单。
 * 页面靠 UI 保证（订单类型来自所在页面上下文），CLI 没有这层 UI，
 * 不校验就会出现"收款"登记在进货单上：单据加的是 paidAmount，而流水按 receipt 统计，
 * 两边口径立刻打架。
 */

const METHOD = z.enum(["cash", "bank", "wechat", "alipay", "other"]);

const createSchema = z.object({
  direction: z.enum(["receipt", "payment"]),
  orderType: z.enum(["sale", "purchase"]),
  orderId: z.coerce.number().int().positive("请指定单据 --order-id"),
  amount: requiredNumber({
    invalid: "请填写金额",
    min: 0,
    minMessage: "金额不能为负",
    max: 9_999_999_999.99,
    maxMessage: "金额过大",
  }).refine((v) => v > 0, "金额必须大于 0"),
  method: METHOD.default("cash"),
  remark: z.string().trim().max(200).optional(),
});

export type CreatePaymentInput = z.input<typeof createSchema>;

const money = (n: number) => n.toFixed(2);

export async function createPayment(
  actor: Actor,
  rawInput: CreatePaymentInput,
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role === "sales") return fail("FORBIDDEN", "业务员无收付款权限");
  const parsed = createSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "输入有误");
  const { direction, orderType, orderId, amount, method, remark } = parsed.data;

  // 配对校验（页面靠 UI 保证，CLI 必须自己挡）
  const expectOrderType = direction === "receipt" ? "sale" : "purchase";
  if (orderType !== expectOrderType) {
    return fail(
      "INVALID",
      direction === "receipt"
        ? "收款只能对售卖单（--order-type sale）"
        : "付款只能对进货单（--order-type purchase）"
    );
  }

  // 未结清 = 单额 − 已收付 − 未作废退货；同时拿到单号与状态
  let orderNo = "";
  let outstanding = 0;
  if (orderType === "sale") {
    const order = await prisma.saleOrder.findUnique({
      where: { id: orderId },
      include: { returns: { where: { status: "confirmed" }, select: { totalAmount: true } } },
    });
    if (!order) return fail("NOT_FOUND", `售卖单不存在：#${orderId}`);
    if (order.status === "voided") return fail("RULE", "已作废售卖单不可收款");
    const returned = order.returns.reduce((s, r) => s + Number(r.totalAmount), 0);
    outstanding = Number(order.totalAmount) - Number(order.receivedAmount) - returned;
    orderNo = order.orderNo;
  } else {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { returns: { where: { status: "confirmed" }, select: { totalAmount: true } } },
    });
    if (!order) return fail("NOT_FOUND", `进货单不存在：#${orderId}`);
    if (order.status === "voided") return fail("RULE", "已作废进货单不可付款");
    const returned = order.returns.reduce((s, r) => s + Number(r.totalAmount), 0);
    outstanding = Number(order.totalAmount) - Number(order.paidAmount) - returned;
    orderNo = order.orderNo;
  }
  if (amount > outstanding) {
    return fail(
      "RULE",
      `超出未结清金额：${orderNo} 未结清 ${money(outstanding)}，本次 ${money(amount)}`
    );
  }

  const prefix = direction === "receipt" ? ORDER_NO_PREFIXES.PAY : ORDER_NO_PREFIXES.POF;
  try {
    const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
      const nextNo = await nextPaymentNo(tx, prefix);
      const created = await tx.payment.create({
        data: {
          orderNo: nextNo,
          direction,
          orderType,
          orderId,
          amount,
          method,
          remark: remark || null,
          operatorId: actor.userId,
          ...provenanceFor(actor),
        },
        select: { id: true, orderNo: true },
      });
      // 同步冗余列：单据已收/已付
      await incrementPaid(tx, orderType, orderId, amount);
      await writeAudit({
        userId: actor.userId,
        action: "create",
        entityType: "payment",
        entityId: created.id,
        tx,
        ip: auditIp(actor),
        ...auditProvenance(actor),
        after: {
          orderNo: created.orderNo,
          direction,
          orderType,
          orderId,
          amount,
          method,
          source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web",
          runId: actor.runId ?? null,
        },
      });
      return {
        收付款单: created.orderNo,
        类型: direction === "receipt" ? "收款" : "付款",
        关联单据: orderNo,
        金额: money(amount),
        方式: method,
        该单原未结清: money(outstanding),
        该单收付后未结清: money(outstanding - amount),
      };
    });
    return ok({ committed, dryRun: !committed, ...(committed ? {} : { 说明: "这是预演，什么都没写。确认后加 --yes" }), plan });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return fail("CONFLICT", "收付款单号冲突（并发），请重试");
    }
    console.error("[payment.create] 失败:", e);
    return fail("INTERNAL", e instanceof Error ? e.message : "登记失败");
  }
}

export async function voidPayment(
  actor: Actor,
  rawInput: { id: number; reason: string },
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role === "sales") return fail("FORBIDDEN", "业务员无此权限");
  const parsed = z
    .object({ id: z.coerce.number().int().positive(), reason: z.string().trim().min(1, "请填写作废原因").max(200) })
    .safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const { id, reason } = parsed.data;

  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment) return fail("NOT_FOUND", `收付款记录不存在：#${id}`);
  if (payment.status === "voided") return fail("RULE", `记录 ${payment.orderNo} 已作废`);

  const amount = Number(payment.amount);
  const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
    await tx.payment.update({
      where: { id },
      data: { status: "voided", voidedBy: actor.userId, voidedAt: new Date(), voidReason: reason },
    });
    // 冲回单据已收/已付
    await incrementPaid(tx, payment.orderType, payment.orderId, -amount);
    await writeAudit({
      userId: actor.userId,
      action: "void",
      entityType: "payment",
      entityId: id,
      tx,
      ip: auditIp(actor),
        ...auditProvenance(actor),
      before: { orderNo: payment.orderNo, status: payment.status },
      after: {
        orderNo: payment.orderNo,
        status: "voided",
        voidReason: reason,
        source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web",
        runId: actor.runId ?? null,
      },
    });
    return { 收付款单: payment.orderNo, 操作: "作废", 冲回金额: money(amount), 关联单据: `${payment.orderType}#${payment.orderId}` };
  });
  return ok({ committed, dryRun: !committed, ...(committed ? {} : { 说明: "这是预演，什么都没写。确认后加 --yes" }), plan });
}

/** 单据已收/已付金额的增减（登记 +、作废 −），冗余列是应收应付的口径来源 */
async function incrementPaid(tx: TxClient, orderType: PaymentOrderType, orderId: number, delta: number) {
  if (orderType === "sale") {
    await tx.saleOrder.update({ where: { id: orderId }, data: { receivedAmount: { increment: delta } } });
    return;
  }
  if (orderType === "purchase") {
    await tx.purchaseOrder.update({ where: { id: orderId }, data: { paidAmount: { increment: delta } } });
    return;
  }
  // 枚举里还有 sale_return / purchase_return 两个值，代码里从未写入过（报告 03 §3 已核实）。
  // 真遇到（历史数据）就明确报错，而不是像网页那样落进 else 分支去改一张进货单
  // ——那会把一张退货单的金额加到某个进货单的已付上。
  throw new Error(`不支持的关联单据类型：${orderType}（本系统只支持 sale / purchase）`);
}

/** 收付款单号：PAY/POF + 日期 + 当日序号（查 payment 表本身，与网页同一套） */
async function nextPaymentNo(tx: TxClient, prefix: string): Promise<string> {
  const rows = await tx.payment.findMany({
    where: { orderNo: { startsWith: `${prefix}${todayCompact()}-` } },
    select: { orderNo: true },
  });
  let maxSeq = 0;
  for (const r of rows) {
    const seq = Number(/-(\d{4})$/.exec(r.orderNo)?.[1] ?? 0);
    if (seq > maxSeq) maxSeq = seq;
  }
  return buildOrderNo(prefix, maxSeq + 1);
}
