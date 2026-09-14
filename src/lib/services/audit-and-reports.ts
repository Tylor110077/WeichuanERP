import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { dateRange, buildReport, REPORT_TABS, type ReportTabKey } from "@/lib/reports";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 报表与审计日志的查询服务。
 *
 * 报表：直接复用 lib/reports.ts 的 buildReport —— 页面、Excel 导出、CLI 三处同一份口径。
 * 汇总表里已按 §13.8 #3/#4 加了「净额」与「估价待补成本未计」的标注行。
 *
 * 审计日志：与审计页同口径（时间倒序、每页 20、仅管理员），另外开放
 * 实体/用户筛选——CLI 用它的场景就是"查这批变更谁做的"。
 */

/* ------------------------------------------------------------ 报表 */

const reportSchema = z.object({
  tab: z
    .enum(REPORT_TABS.map((t) => t.key) as [ReportTabKey, ...ReportTabKey[]])
    .default("summary"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from 应为 YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to 应为 YYYY-MM-DD").optional(),
});

export type ReportInput = z.input<typeof reportSchema>;

/** 本地时区的 YYYY-MM-DD。**不要用 toISOString().slice(0,10)**：
 *  本地 9/1 00:00 在 +08:00 下是 UTC 的 8/31 16:00，会显示成"8月31日"（踩过一次）。 */
const day = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function runReport(actor: Actor, rawInput: ReportInput): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role === "sales") return fail("FORBIDDEN", "无权限查看报表（管理员/老板）");
  const parsed = reportSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const input = parsed.data;

  const result = await buildReport(input.tab, input.from, input.to);
  const range = dateRange(input.from, input.to);
  return ok({
    tab: input.tab,
    title: result.title,
    /** 行数被 MAX_REPORT_ROWS 截断时为 true（完整数据走 export） */
    capped: result.capped ?? false,
    applied: { from: input.from ?? null, to: input.to ?? null, limit: result.capped ? "已截断" : "未截断" },
    columns: result.columns.map((c) => ({ key: c.key, label: c.label })),
    rows: result.rows,
    /** 便于 agent 一次拿全：把行按列顺序转成二维数组，减少字段名歧义 */
    rowValues: result.rows.map((r) => result.columns.map((c) => r[c.key] ?? null)),
    /** 本次实际生效的期间（本地时区；两个数都与页面同口径） */
    range: { from: day(range.gte), to: day(range.lte) },
  });
}

/* -------------------------------------------------------- 审计日志 */

const PAGE = 20;

const auditSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from 应为 YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to 应为 YYYY-MM-DD").optional(),
  entityType: z.string().trim().min(1).max(50).optional(),
  entityId: z.coerce.number().int().optional(),
  username: z.string().trim().min(1).max(50).optional(),
  action: z.enum(["login", "logout", "create", "update", "delete", "receive", "void", "reset_password"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export type ListAuditLogsInput = z.input<typeof auditSchema>;

export async function listAuditLogs(
  actor: Actor,
  rawInput: ListAuditLogsInput
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role !== "admin") return fail("FORBIDDEN", "无权限访问审计日志（仅管理员）");
  const parsed = auditSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const input = parsed.data;

  const page = Math.max(1, input.page ?? 1);
  const pageSize = input.pageSize ?? PAGE;
  const range = dateRange(input.from, input.to);

  const where = {
    createdAt: { gte: range.gte, lte: range.lte },
    ...(input.entityType ? { entityType: input.entityType } : {}),
    ...(input.entityId != null ? { entityId: BigInt(input.entityId) } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(input.username ? { user: { username: input.username } } : {}),
  };

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { username: true, displayName: true } } },
    }),
  ]);

  return ok({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    applied: {
      from: day(range.gte),
      to: day(range.lte),
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      username: input.username ?? null,
      action: input.action ?? null,
      orderBy: "createdAt desc",
    },
    rows: logs.map((l) => ({
      id: l.id,
      date: day(l.createdAt),
      time: l.createdAt.toISOString().slice(11, 19),
      user: l.user ? `${l.user.displayName}（${l.user.username}）` : "—",
      action: l.action,
      entityType: l.entityType,
      /** 数字主键显示的仍是 entityId；非数字标识（如 backup-config）走 entityKey */
      entityKey: l.entityId != null ? `#${l.entityId}` : (l.entityKey ?? ""),
      ip: l.ip ?? "",
      // before/after 是 JSON 快照，内容可能很长：表格里给摘要，完整内容用 --json
      hasBefore: l.beforeJson != null,
      hasAfter: l.afterJson != null,
      before: l.beforeJson ?? null,
      after: l.afterJson ?? null,
    })),
  });
}
