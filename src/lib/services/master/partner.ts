import { z } from "zod";
import { zBoolean } from "@/lib/form-bool";
import { prisma, type TxClient } from "@/lib/prisma";
import { auditIp, auditProvenance, writeAudit } from "@/lib/audit";
import { runInTransaction } from "@/lib/services/dry-run";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 客户 / 厂家的写操作服务（网页 action 与 CLI 共用）。
 *
 * 口径照抄 src/app/(main)/customers/actions.ts 与 suppliers/actions.ts，改动必须同步改页面：
 * - 名称必填、其余可空；客户可挂分组与标签（标签是覆盖式重建）
 * - 仅管理员可维护（与 `requireMasterDataWrite` 同一句话）
 *
 * **一处按 §13.8 B3 裁决与网页不同**：默认**拒绝重名**（页面两者都不查重，库上也没有唯一约束）。
 * 原因是重名会污染开单时的"按名建档"逻辑（sale-orders/actions.ts 用厂家名匹配建档），
 * 让 Agent 更容易就着已有档案开单、而不是三天后库里出现三个"远东电缆"。
 * 确实需要重名时显式加 `allowDuplicate`。
 */

const money = (n: number) => n.toFixed(2);

/** "1,2,3" 或 [1,2,3] 都收（CLI 传字符串、网页传数组） */
const csvNumbers = z
  .union([z.string(), z.array(z.coerce.number().int().positive())])
  .optional()
  .transform((v) => {
    if (v == null) return [] as number[];
    const list = Array.isArray(v) ? v : v.split(",").map((s) => s.trim()).filter(Boolean).map(Number);
    return list.filter((n) => Number.isInteger(n) && n > 0);
  });

/* ------------------------------------------------------------ 客户 */

const customerSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(1, "请填写客户名称").max(100),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(200).optional(),
  remark: z.string().trim().max(200).optional(),
  groupId: z.coerce.number().int().positive().nullable().optional(),
  tagIds: csvNumbers,
  /** 默认拒绝重名（见文件头说明） */
  allowDuplicate: zBoolean().optional(),
});

export type SaveCustomerInput = z.input<typeof customerSchema>;

export async function saveCustomer(
  actor: Actor,
  rawInput: SaveCustomerInput,
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role !== "admin") return fail("FORBIDDEN", "基础资料仅管理员可维护");
  const parsed = customerSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "输入有误");
  const input = parsed.data;

  if (input.groupId != null) {
    const group = await prisma.customerGroup.findUnique({ where: { id: input.groupId }, select: { id: true, name: true } });
    if (!group) return fail("INVALID", "分组不存在");
  }
  if (input.tagIds.length > 0) {
    const n = await prisma.customerTag.count({ where: { id: { in: input.tagIds } } });
    if (n !== input.tagIds.length) return fail("INVALID", "存在无效标签");
  }

  const before = input.id
    ? await prisma.customer.findUnique({ where: { id: input.id }, include: { tagLinks: true } })
    : null;
  if (input.id && !before) return fail("NOT_FOUND", `客户不存在：#${input.id}`);

  if (!input.allowDuplicate) {
    const dup = await prisma.customer.findFirst({
      where: { name: input.name, ...(input.id ? { id: { not: input.id } } : {}) },
      select: { id: true, name: true, phone: true },
    });
    if (dup) {
      return fail(
        "CONFLICT",
        `已有同名客户：#${dup.id} ${dup.name}${dup.phone ? `（${dup.phone}）` : ""}。` +
          `要新建同名客户请加 allowDuplicate；要改这个客户请用 update --id ${dup.id}`
      );
    }
  }

  const data = {
    name: input.name,
    phone: input.phone ?? "",
    address: input.address ?? "",
    remark: input.remark ?? "",
    groupId: input.groupId ?? null,
  };

  const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
    const id = before?.id;
    if (id) {
      await tx.customer.update({ where: { id }, data });
      await tx.customerTagLink.deleteMany({ where: { customerId: id } });
      await replaceTags(tx, id, input.tagIds);
      await writeAudit({
        userId: actor.userId,
        action: "update",
        entityType: "customer",
        entityId: id,
        tx,
        ip: auditIp(actor),
        ...auditProvenance(actor),
        before: { name: before.name, groupId: before.groupId, tagIds: before.tagLinks.map((l) => l.tagId) },
        // 更新同样要记来源：溯源要求"所有代做的都看得出来"，不能只在创建时记
        after: {
          name: data.name,
          groupId: data.groupId,
          tagIds: input.tagIds,
          source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web",
          runId: actor.runId ?? null,
        },
      });
      return { 客户: { id, name: data.name }, 操作: "更新", 分组: data.groupId, 标签: input.tagIds };
    }
    const created = await tx.customer.create({ data, select: { id: true, name: true } });
    await replaceTags(tx, created.id, input.tagIds);
    await writeAudit({
      userId: actor.userId,
      action: "create",
      entityType: "customer",
      entityId: created.id,
      tx,
      ip: auditIp(actor),
        ...auditProvenance(actor),
      after: { name: created.name, groupId: data.groupId, tagIds: input.tagIds, source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web" },
    });
    return { 客户: created, 操作: "新建", 分组: data.groupId, 标签: input.tagIds };
  });

  return ok({ committed, dryRun: !committed, ...(committed ? {} : { 说明: "这是预演，什么都没写。确认后加 --yes" }), plan });
}

async function replaceTags(tx: TxClient, customerId: number, tagIds: number[]) {
  if (tagIds.length === 0) return;
  await tx.customerTagLink.createMany({
    data: tagIds.map((tagId) => ({ customerId, tagId })),
    skipDuplicates: true,
  });
}

/* ------------------------------------------------------------ 厂家 */

const supplierSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(1, "请填写厂家名称").max(100),
  contact: z.string().trim().max(50).optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(200).optional(),
  remark: z.string().trim().max(200).optional(),
  allowDuplicate: zBoolean().optional(),
});

export type SaveSupplierInput = z.input<typeof supplierSchema>;

export async function saveSupplier(
  actor: Actor,
  rawInput: SaveSupplierInput,
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role !== "admin") return fail("FORBIDDEN", "基础资料仅管理员可维护");
  const parsed = supplierSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "输入有误");
  const input = parsed.data;

  const before = input.id
    ? await prisma.supplier.findUnique({ where: { id: input.id } })
    : null;
  if (input.id && !before) return fail("NOT_FOUND", `厂家不存在：#${input.id}`);

  if (!input.allowDuplicate) {
    const dup = await prisma.supplier.findFirst({
      where: { name: input.name, ...(input.id ? { id: { not: input.id } } : {}) },
      select: { id: true, name: true },
    });
    if (dup) {
      return fail(
        "CONFLICT",
        `已有同名厂家：#${dup.id} ${dup.name}。要新建同名厂家请加 allowDuplicate；要改它请用 update --id ${dup.id}`
      );
    }
  }

  const data = {
    name: input.name,
    contact: input.contact ?? "",
    phone: input.phone ?? "",
    address: input.address ?? "",
    remark: input.remark ?? "",
  };

  const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
    const id = before?.id;
    if (id) {
      await tx.supplier.update({ where: { id }, data });
      await writeAudit({
        userId: actor.userId,
        action: "update",
        entityType: "supplier",
        entityId: id,
        tx,
        ip: auditIp(actor),
        ...auditProvenance(actor),
        before: { name: before.name },
        after: {
          name: data.name,
          source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web",
          runId: actor.runId ?? null,
        },
      });
      return { 厂家: { id, name: data.name }, 操作: "更新" };
    }
    const created = await tx.supplier.create({ data, select: { id: true, name: true, searchPinyin: true } });
    await writeAudit({
      userId: actor.userId,
      action: "create",
      entityType: "supplier",
      entityId: created.id,
      tx,
      ip: auditIp(actor),
        ...auditProvenance(actor),
      after: { name: created.name, source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web" },
    });
    return { 厂家: { id: created.id, name: created.name }, 拼音检索串: created.searchPinyin };
  });

  return ok({ committed, dryRun: !committed, ...(committed ? {} : { 说明: "这是预演，什么都没写。确认后加 --yes" }), plan });
}

/** 供将来的命令复用（如按厂家名批量补档） */
export { money };
