import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditIp, auditProvenance, writeAudit } from "@/lib/audit";
import { DOC_TYPES, isDocType, type DocType } from "@/lib/services/provenance";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 审核服务：审核台与 CLI 共用。
 *
 * 三条硬约束（计划 §5.6）：
 * 1. **审核只能由人做**（注册表里这些 op 标了 humanOnly → Agent 令牌在端点层就被拒）
 * 2. **不能自审自批**：Agent 建的单个个都带 `actorKind=agent`，人类的审核记录带 `reviewedBy`；
 *    服务层再兜一道——Agent 令牌一律拒绝（双保险）
 * 3. **驳回不等于撤销**：被驳回的单据**已经生效**（库存与成本当场动过），
 *    按不变量 1 不能回溯改成本快照。所以驳回只打标 + 进「待作废」待办，
 *    由人去作废（那是这个系统里唯一能让单据退出库存/成本账的手段）。
 */

export interface ReviewSummary {
  docType: DocType;
  docId: number;
  docNo: string;
  /** 金额（单据总额） */
  amount: string;
  createdAt: string;
  actorKind: "human" | "agent";
  agentRunId: string | null;
  apiTokenId: number | null;
  reviewStatus: "not_required" | "pending_review" | "approved" | "rejected";
  reviewedBy: number | null;
  reviewedAt: string | null;
  version: number;
  revisionOf: number | null;
  /** 只有待作废（已驳回）时才提示 */
  needsVoid: boolean;
}

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** 按 docType 取单据摘要（金额字段与单号字段名在 5 张表里各不相同，集中在这里收敛） */
async function loadDoc(docType: DocType, docId: number): Promise<ReviewSummary | null> {
  const base = { actorKind: true, agentRunId: true, apiTokenId: true, reviewStatus: true, reviewedBy: true, reviewedAt: true, version: true, revisionOf: true, createdAt: true } as const;
  if (docType === "sale_order") {
    const d = await prisma.saleOrder.findUnique({ where: { id: docId }, select: { orderNo: true, totalAmount: true, ...base } });
    if (!d) return null;
    return { docType, docId, docNo: d.orderNo, amount: Number(d.totalAmount).toFixed(2), createdAt: day(d.createdAt), actorKind: d.actorKind, agentRunId: d.agentRunId, apiTokenId: d.apiTokenId, reviewStatus: d.reviewStatus, reviewedBy: d.reviewedBy, reviewedAt: d.reviewedAt ? day(d.reviewedAt) : null, version: d.version, revisionOf: d.revisionOf, needsVoid: d.reviewStatus === "rejected" };
  }
  if (docType === "purchase_order") {
    const d = await prisma.purchaseOrder.findUnique({ where: { id: docId }, select: { orderNo: true, totalAmount: true, ...base } });
    if (!d) return null;
    return { docType, docId, docNo: d.orderNo, amount: Number(d.totalAmount).toFixed(2), createdAt: day(d.createdAt), actorKind: d.actorKind, agentRunId: d.agentRunId, apiTokenId: d.apiTokenId, reviewStatus: d.reviewStatus, reviewedBy: d.reviewedBy, reviewedAt: d.reviewedAt ? day(d.reviewedAt) : null, version: d.version, revisionOf: d.revisionOf, needsVoid: d.reviewStatus === "rejected" };
  }
  if (docType === "sale_return") {
    const d = await prisma.saleReturn.findUnique({ where: { id: docId }, select: { orderNo: true, totalAmount: true, ...base } });
    if (!d) return null;
    return { docType, docId, docNo: d.orderNo, amount: Number(d.totalAmount).toFixed(2), createdAt: day(d.createdAt), actorKind: d.actorKind, agentRunId: d.agentRunId, apiTokenId: d.apiTokenId, reviewStatus: d.reviewStatus, reviewedBy: d.reviewedBy, reviewedAt: d.reviewedAt ? day(d.reviewedAt) : null, version: d.version, revisionOf: d.revisionOf, needsVoid: d.reviewStatus === "rejected" };
  }
  if (docType === "purchase_return") {
    const d = await prisma.purchaseReturn.findUnique({ where: { id: docId }, select: { orderNo: true, totalAmount: true, ...base } });
    if (!d) return null;
    return { docType, docId, docNo: d.orderNo, amount: Number(d.totalAmount).toFixed(2), createdAt: day(d.createdAt), actorKind: d.actorKind, agentRunId: d.agentRunId, apiTokenId: d.apiTokenId, reviewStatus: d.reviewStatus, reviewedBy: d.reviewedBy, reviewedAt: d.reviewedAt ? day(d.reviewedAt) : null, version: d.version, revisionOf: d.revisionOf, needsVoid: d.reviewStatus === "rejected" };
  }
  const d = await prisma.payment.findUnique({ where: { id: docId }, select: { orderNo: true, amount: true, ...base } });
  if (!d) return null;
  return { docType, docId, docNo: d.orderNo, amount: Number(d.amount).toFixed(2), createdAt: day(d.createdAt), actorKind: d.actorKind, agentRunId: d.agentRunId, apiTokenId: d.apiTokenId, reviewStatus: d.reviewStatus, reviewedBy: d.reviewedBy, reviewedAt: d.reviewedAt ? day(d.reviewedAt) : null, version: d.version, revisionOf: d.revisionOf, needsVoid: d.reviewStatus === "rejected" };
}

/**
 * Agent 代做统计（工作台 / CLI 共用）：Agent 建的单有多少，其中待审/已通过/已驳回各多少。
 * 一次 UNION ALL 查完 5 张表——统计是给看板用的，不该变成 5 次往返。
 */
export interface AgentContribution {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

export async function agentContribution(): Promise<AgentContribution> {
  const rows = await prisma.$queryRaw<{ review_status: string; n: bigint }[]>`
    SELECT review_status, COUNT(*) AS n FROM sale_orders      WHERE actor_kind = 'agent' GROUP BY review_status
    UNION ALL
    SELECT review_status, COUNT(*) AS n FROM purchase_orders  WHERE actor_kind = 'agent' GROUP BY review_status
    UNION ALL
    SELECT review_status, COUNT(*) AS n FROM sale_returns     WHERE actor_kind = 'agent' GROUP BY review_status
    UNION ALL
    SELECT review_status, COUNT(*) AS n FROM purchase_returns WHERE actor_kind = 'agent' GROUP BY review_status
    UNION ALL
    SELECT review_status, COUNT(*) AS n FROM payments         WHERE actor_kind = 'agent' GROUP BY review_status
  `;
  const out: AgentContribution = { total: 0, pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) {
    const n = Number(r.n);
    out.total += n;
    if (r.review_status === "pending_review") out.pending += n;
    else if (r.review_status === "approved") out.approved += n;
    else if (r.review_status === "rejected") out.rejected += n;
  }
  return out;
}

const listSchema = z.object({
  docType: z.string().optional(),
  status: z.enum(["pending_review", "approved", "rejected", "not_required"]).optional(),
  agentRunId: z.string().trim().max(50).optional(),
  /** 只看 Agent 代做的 */
  agentOnly: z.boolean().optional(),
  /** 只看"已驳回但还没作废"的待办 */
  needsVoid: z.boolean().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export type ReviewListInput = z.input<typeof listSchema>;

/** 审核台列表：默认待审核；可按类型/批次/来源筛 */
export async function listReviews(actor: Actor, rawInput: ReviewListInput): Promise<CliResult<Record<string, unknown>>> {
  const parsed = listSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const input = parsed.data;
  if (input.docType && !isDocType(input.docType)) {
    return fail("INVALID", `docType 只能是：${Object.keys(DOC_TYPES).join(" / ")}`);
  }
  const types: DocType[] = input.docType ? [input.docType as DocType] : (Object.keys(DOC_TYPES) as DocType[]);
  const status = input.status ?? "pending_review";
  const page = Math.max(1, input.page ?? 1);
  const pageSize = input.pageSize ?? 50;

  const rows: ReviewSummary[] = [];
  for (const docType of types) {
    const where = {
      reviewStatus: status,
      ...(input.agentOnly ? { actorKind: "agent" as const } : {}),
      ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
    };
    const ids =
      docType === "sale_order"
        ? (await prisma.saleOrder.findMany({ where, select: { id: true }, orderBy: { createdAt: "desc" } })).map((r) => r.id)
        : docType === "purchase_order"
          ? (await prisma.purchaseOrder.findMany({ where, select: { id: true }, orderBy: { createdAt: "desc" } })).map((r) => r.id)
          : docType === "sale_return"
            ? (await prisma.saleReturn.findMany({ where, select: { id: true }, orderBy: { createdAt: "desc" } })).map((r) => r.id)
            : docType === "purchase_return"
              ? (await prisma.purchaseReturn.findMany({ where, select: { id: true }, orderBy: { createdAt: "desc" } })).map((r) => r.id)
              : (await prisma.payment.findMany({ where, select: { id: true }, orderBy: { createdAt: "desc" } })).map((r) => r.id);
    for (const id of ids) {
      const s = await loadDoc(docType, id);
      if (s) rows.push(s);
    }
  }
  // 驳回待作废：单独一遍（不论 status 筛选，这是待办）
  if (input.needsVoid) {
    rows.length = 0;
    for (const docType of types) {
      const where = { reviewStatus: "rejected" as const };
      const ids =
        docType === "sale_order"
          ? (await prisma.saleOrder.findMany({ where, select: { id: true } })).map((r) => r.id)
          : docType === "purchase_order"
            ? (await prisma.purchaseOrder.findMany({ where, select: { id: true } })).map((r) => r.id)
            : [];
      for (const id of ids) {
        const s = await loadDoc(docType, id);
        if (s) rows.push(s);
      }
    }
  }

  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const total = rows.length;
  return ok({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    applied: { docType: input.docType ?? "全部", status, agentOnly: input.agentOnly ?? false, agentRunId: input.agentRunId ?? null, needsVoid: input.needsVoid ?? false },
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
  });
}

/** 单张单据的审核详情：单据摘要 + 历轮意见（旧版追血缘） */
export async function showReview(actor: Actor, rawInput: { docType: string; docId: number }): Promise<CliResult<Record<string, unknown>>> {
  if (!isDocType(rawInput.docType)) return fail("INVALID", `docType 只能是：${Object.keys(DOC_TYPES).join(" / ")}`);
  const doc = await loadDoc(rawInput.docType, rawInput.docId);
  if (!doc) return fail("NOT_FOUND", `单据不存在：${rawInput.docType}#${rawInput.docId}`);
  const notes = await prisma.reviewNote.findMany({
    where: { docType: rawInput.docType, docId: rawInput.docId },
    orderBy: [{ round: "asc" }, { id: "asc" }],
    include: { reviewer: { select: { displayName: true, username: true } } },
  });
  return ok({
    单据: doc,
    审核意见: notes.map((n) => ({
      round: n.round,
      verdict: n.verdict === "approve" ? "通过" : n.verdict === "reject" ? "驳回" : "评论",
      notes: n.notes,
      reviewer: `${n.reviewer.displayName}（${n.reviewer.username}）`,
      at: day(n.createdAt),
    })),
    ...(doc.reviewStatus === "rejected"
      ? { 待办: "这张单已被驳回，但它**已经生效**（库存与成本当场动过）。请作废它，或让 Agent 用 revise 产出新版本。" }
      : {}),
  });
}

const verdictSchema = z.object({
  docType: z.string(),
  docId: z.coerce.number().int().positive(),
  notes: z.string().trim().min(1, "请填写意见（驳回时说明原因）").max(1000),
});

/** 通过 / 驳回 / 仅评论。三者共用一套留痕逻辑。 */
async function verdict(
  actor: Actor,
  rawInput: { docType: string; docId: number; notes: string },
  kind: "approve" | "reject" | "comment",
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  // 双保险：注册表已把这三个 op 标为 humanOnly（端点层就拦 Agent 令牌），这里再挡一道
  if (actor.kind === "agent") return fail("FORBIDDEN", "Agent 令牌不能审核（不能自审自批）");
  const parsed = verdictSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const { docType, docId, notes } = parsed.data;
  if (!isDocType(docType)) return fail("INVALID", `docType 只能是：${Object.keys(DOC_TYPES).join(" / ")}`);

  const doc = await loadDoc(docType, docId);
  if (!doc) return fail("NOT_FOUND", `单据不存在：${docType}#${docId}`);

  // 轮次：同一张单的既有意见数 + 1（多轮不覆盖）
  const prev = await prisma.reviewNote.findMany({ where: { docType, docId }, orderBy: { round: "desc" }, take: 1 });
  const round = (prev[0]?.round ?? 0) + 1;
  const nextStatus = kind === "comment" ? doc.reviewStatus : kind === "approve" ? "approved" : "rejected";

  if (kind !== "comment" && doc.reviewStatus === nextStatus) {
    return fail("RULE", `这张单已经是「${nextStatus === "approved" ? "已通过" : "已驳回"}」状态`);
  }

  const label = kind === "approve" ? "通过" : kind === "reject" ? "驳回" : "评论";
  const plan = {
    单据: `${DOC_TYPES[docType]} ${doc.docNo}`,
    判断: label,
    审核状态: `${doc.reviewStatus} → ${nextStatus}`,
    ...(kind === "reject"
      ? { 重要: "驳回**不等于撤销**：这张单已生效（库存/成本当场动过）。请把它作废，或让 Agent 用 revise 产出新版本。" }
      : {}),
    意见: notes,
  };
  if (opts.dryRun) return ok({ committed: false, dryRun: true, 说明: "这是预演，什么都没写。确认后加 --yes", plan });

  await prisma.$transaction(async (tx) => {
    await tx.reviewNote.create({ data: { docType, docId, round, verdict: kind, notes, reviewerUserId: actor.userId } });
    if (kind !== "comment") {
      const data = { reviewStatus: nextStatus as "approved" | "rejected", reviewedBy: actor.userId, reviewedAt: new Date() };
      if (docType === "sale_order") await tx.saleOrder.update({ where: { id: docId }, data });
      else if (docType === "purchase_order") await tx.purchaseOrder.update({ where: { id: docId }, data });
      else if (docType === "sale_return") await tx.saleReturn.update({ where: { id: docId }, data });
      else if (docType === "purchase_return") await tx.purchaseReturn.update({ where: { id: docId }, data });
      else await tx.payment.update({ where: { id: docId }, data });
    }
    await writeAudit({
      userId: actor.userId,
      action: "update",
      entityType: `review_${docType}`,
      entityId: docId,
      tx,
      ip: auditIp(actor),
        ...auditProvenance(actor),
      before: { reviewStatus: doc.reviewStatus },
      after: { reviewStatus: nextStatus, verdict: kind, round, notes: notes.slice(0, 200) },
    });
  });

  return ok({ committed: true, dryRun: false, plan });
}

export async function approveReview(actor: Actor, input: { docType: string; docId: number; notes: string }, opts: { dryRun: boolean }) {
  return verdict(actor, input, "approve", opts);
}
export async function rejectReview(actor: Actor, input: { docType: string; docId: number; notes: string }, opts: { dryRun: boolean }) {
  return verdict(actor, input, "reject", opts);
}
export async function commentReview(actor: Actor, input: { docType: string; docId: number; notes: string }, opts: { dryRun: boolean }) {
  return verdict(actor, input, "comment", opts);
}
