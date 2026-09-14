import { z } from "zod";
import { zBoolean } from "@/lib/form-bool";
import { prisma, type TxClient } from "@/lib/prisma";
import { auditIp, auditProvenance, writeAudit } from "@/lib/audit";
import { runInTransaction } from "@/lib/services/dry-run";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 单位 / 分类的写操作服务（网页 action 与 CLI 共用）。
 *
 * 口径照抄 src/app/(main)/units/actions.ts 与 categories/actions.ts，改动必须同步改页面：
 * - 只有 name 一个字段；**两者都有查重**（页面就查了，且库上 name 是唯一索引）
 * - 仅管理员可维护
 *
 * 与客户/厂家不同：这里是"名称即身份"，重名没有 `allowDuplicate` 的口子——
 * 单位/分类重名没有任何业务意义，只会让人开单时选错。
 */

const schema = z.object({
  id: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(1, "请填写名称").max(50),
});

export type SaveTaxonomyInput = z.input<typeof schema>;

type Kind = "unit" | "category";

const LABEL: Record<Kind, string> = { unit: "单位", category: "分类" };

/**
 * 单位与分类的流程一模一样，只有模型不同（分类的 Prisma 模型叫 productCategory）。
 * 这里用一个**最小结构接口**描述用到的四个方法，避免为了两个模型写两份重复流程；
 * 代价是一次带注释的类型转换——比复制一份 30 行的流程更好维护。
 */
interface TaxonomyDelegate {
  findFirst(args: unknown): Promise<{ id: number; name: string } | null>;
  findUnique(args: unknown): Promise<{ id: number; name: string; status: number } | null>;
  create(args: unknown): Promise<{ id: number; name: string }>;
  update(args: unknown): Promise<unknown>;
}
function modelOf(kind: Kind, db: typeof prisma | TxClient): TaxonomyDelegate {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  return (kind === "unit" ? anyDb.unit : anyDb.productCategory) as TaxonomyDelegate;
}

export async function saveUnit(
  actor: Actor,
  rawInput: SaveTaxonomyInput,
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  return saveTaxonomy(actor, "unit", rawInput, opts);
}

export async function saveCategory(
  actor: Actor,
  rawInput: SaveTaxonomyInput,
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  return saveTaxonomy(actor, "category", rawInput, opts);
}

async function saveTaxonomy(
  actor: Actor,
  kind: Kind,
  rawInput: SaveTaxonomyInput,
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role !== "admin") return fail("FORBIDDEN", "基础资料仅管理员可维护");
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "输入有误");
  const { id, name } = parsed.data;
  const label = LABEL[kind];

  const dup = await modelOf(kind, prisma).findFirst({
    where: { name, ...(id ? { NOT: { id } } : {}) },
    select: { id: true, name: true },
  });
  if (dup) return fail("CONFLICT", `${label}名称已存在：#${dup.id} ${dup.name}`);
  if (id) {
    const exists = await modelOf(kind, prisma).findUnique({ where: { id }, select: { id: true } });
    if (!exists) return fail("NOT_FOUND", `${label}不存在：#${id}`);
  }

  const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
    if (id) {
      const before = await modelOf(kind, tx).findUnique({ where: { id }, select: { name: true } });
      await modelOf(kind, tx).update({ where: { id }, data: { name } });
      await writeAudit({
        userId: actor.userId,
        action: "update",
        entityType: kind,
        entityId: id,
        tx,
        ip: auditIp(actor),
        ...auditProvenance(actor),
        before: { name: before?.name ?? "" },
        after: { name, source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web", runId: actor.runId ?? null },
      });
      return { [label]: { id, name }, 操作: "更新" };
    }
    const created = await modelOf(kind, tx).create({ data: { name }, select: { id: true, name: true } });
    await writeAudit({
      userId: actor.userId,
      action: "create",
      entityType: kind,
      entityId: created.id,
      tx,
      ip: auditIp(actor),
        ...auditProvenance(actor),
      after: { name: created.name, source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web", runId: actor.runId ?? null },
    });
    return { [label]: created, 操作: "新建" };
  });

  return ok({ committed, dryRun: !committed, ...(committed ? {} : { 说明: "这是预演，什么都没写。确认后加 --yes" }), plan });
}

/** 启停：单位/分类都是软删（停用后不出现在开单候选里，历史单据仍引用得到） */
export async function setTaxonomyStatus(
  actor: Actor,
  kind: Kind,
  rawInput: { id: number; enabled: boolean },
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role !== "admin") return fail("FORBIDDEN", "基础资料仅管理员可维护");
  const parsed = z
    .object({ id: z.coerce.number().int().positive(), enabled: zBoolean() })
    .safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const { id, enabled } = parsed.data;
  const label = LABEL[kind];

  const row = await modelOf(kind, prisma).findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  if (!row) return fail("NOT_FOUND", `${label}不存在：#${id}`);
  if ((row.status === 1) === enabled) return fail("RULE", `${label}「${row.name}」已经是${enabled ? "启用" : "停用"}状态`);

  const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
    await modelOf(kind, tx).update({ where: { id }, data: { status: enabled ? 1 : 0 } });
    await writeAudit({
      userId: actor.userId,
      action: "update",
      entityType: kind,
      entityId: id,
      tx,
      ip: auditIp(actor),
        ...auditProvenance(actor),
      before: { name: row.name, status: row.status },
      after: { name: row.name, status: enabled ? 1 : 0, source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web", runId: actor.runId ?? null },
    });
    return { [label]: row.name, 状态: enabled ? "启用" : "停用" };
  });

  return ok({ committed, dryRun: !committed, ...(committed ? {} : { 说明: "这是预演，什么都没写。确认后加 --yes" }), plan });
}
