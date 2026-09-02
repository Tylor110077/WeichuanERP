"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireMasterDataWrite } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";

const customerSchema = z.object({
  name: z.string().trim().min(1, "请填写客户名称").max(100),
  contact: z.string().trim().max(50),
  phone: z.string().trim().max(30),
  address: z.string().trim().max(200),
  remark: z.string().trim().max(200),
});

export type FormState = { error?: string; ok?: string } | null;

export async function saveCustomerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
  const idRaw = formData.get("id");
  const id = idRaw ? Number(idRaw) : null;

  const parsed = customerSchema.safeParse({
    name: formData.get("name") ?? "",
    contact: formData.get("contact") ?? "",
    phone: formData.get("phone") ?? "",
    address: formData.get("address") ?? "",
    remark: formData.get("remark") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  const data = parsed.data;

  const groupIdRaw = formData.get("groupId");
  const groupId = groupIdRaw ? Number(groupIdRaw) : null;
  const tagIds = formData
    .getAll("tagIds")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

  if (groupId && !(await prisma.customerGroup.findUnique({ where: { id: groupId } }))) {
    return { error: "组织不存在" };
  }
  if (tagIds.length > 0) {
    const tagCount = await prisma.customerTag.count({ where: { id: { in: tagIds } } });
    if (tagCount !== tagIds.length) return { error: "存在无效标签" };
  }

  if (id) {
    const before = await prisma.customer.findUnique({
      where: { id },
      include: { tagLinks: true },
    });
    if (!before) return { error: "客户不存在" };
    await prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id }, data: { ...data, groupId } });
      await tx.customerTagLink.deleteMany({ where: { customerId: id } });
      if (tagIds.length > 0) {
        await tx.customerTagLink.createMany({
          data: tagIds.map((tagId) => ({ customerId: id, tagId })),
          skipDuplicates: true,
        });
      }
    });
    await writeAudit({
      userId: admin.id,
      action: "update",
      entityType: "customer",
      entityId: id,
      before: {
        name: before.name,
        groupId: before.groupId,
        tagIds: before.tagLinks.map((l) => l.tagId),
      },
      after: { name: data.name, groupId, tagIds },
    });
  } else {
    const customer = await prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({ data: { ...data, groupId } });
      if (tagIds.length > 0) {
        await tx.customerTagLink.createMany({
          data: tagIds.map((tagId) => ({ customerId: created.id, tagId })),
          skipDuplicates: true,
        });
      }
      return created;
    });
    await writeAudit({
      userId: admin.id,
      action: "create",
      entityType: "customer",
      entityId: customer.id,
      after: { name: customer.name, groupId, tagIds },
    });
  }
  revalidatePath("/customers");
  revalidatePath("/customer-groups");
  return { ok: id ? "已更新" : "客户创建成功" };
}

export async function toggleCustomerStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
  const id = Number(formData.get("id"));
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) return { error: "客户不存在" };
  const next = customer.status === 1 ? 0 : 1;
  await prisma.customer.update({ where: { id }, data: { status: next } });
  await writeAudit({
    userId: admin.id,
    action: "update",
    entityType: "customer",
    entityId: id,
    before: { name: customer.name, status: customer.status },
    after: { name: customer.name, status: next },
  });
  revalidatePath("/customers");
  return { ok: next === 1 ? "已启用" : "已停用" };
}

const quickCustomerSchema = z.object({
  name: z.string().trim().min(1, "请填写客户名称").max(100),
  contact: z.string().trim().max(50),
  phone: z.string().trim().max(30),
});

export type QuickCustomerResult = { id: number; name: string } | { error: string };

/** 销售开单页内直接新建客户（仅管理员，符合权限矩阵：客户维护仅管理员）。 */
export async function createQuickCustomerAction(data: {
  name: string;
  contact?: string;
  phone?: string;
  groupId?: number | null; // 新客户所属组织（可空）
  tagIds?: number[]; // 新客户标签（可空）
}): Promise<QuickCustomerResult> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { error: "仅管理员可在开单页新建客户" };

  const parsed = quickCustomerSchema.safeParse({
    name: data.name ?? "",
    contact: data.contact ?? "",
    phone: data.phone ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "输入有误" };

  const groupId = data.groupId ? Number(data.groupId) : null;
  const tagIds = (data.tagIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);

  if (groupId && !(await prisma.customerGroup.findUnique({ where: { id: groupId } }))) {
    return { error: "组织不存在" };
  }
  if (tagIds.length > 0) {
    const tagCount = await prisma.customerTag.count({ where: { id: { in: tagIds } } });
    if (tagCount !== tagIds.length) return { error: "存在无效标签" };
  }

  const customer = await prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({
      data: {
        name: parsed.data.name,
        contact: parsed.data.contact || null,
        phone: parsed.data.phone || null,
        groupId,
      },
      select: { id: true, name: true },
    });
    if (tagIds.length > 0) {
      await tx.customerTagLink.createMany({
        data: tagIds.map((tagId) => ({ customerId: created.id, tagId })),
        skipDuplicates: true,
      });
    }
    return created;
  });
  await writeAudit({
    userId: admin.id,
    action: "create",
    entityType: "customer",
    entityId: customer.id,
    after: {
      name: customer.name,
      contact: parsed.data.contact || null,
      phone: parsed.data.phone || null,
      groupId,
      tagIds,
    },
  });
  revalidatePath("/customers");
  return { id: customer.id, name: customer.name };
}

// ---------------------------------------------------------------------------
// 客户组织 / 标签 维护（仅管理员；快捷创建供开单页与客户表单内联使用）
// ---------------------------------------------------------------------------

export type QuickResult = { id: number; name: string } | { error: string };

export async function createQuickCustomerGroupAction(data: { name: string }): Promise<QuickResult> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { error: "仅管理员可创建客户组织" };
  const name = data.name?.trim() ?? "";
  if (!name || name.length > 50) return { error: "组织名称不能为空（≤50 字）" };
  const dup = await prisma.customerGroup.findUnique({ where: { name } });
  if (dup) return { error: "组织已存在" };
  const group = await prisma.customerGroup.create({ data: { name }, select: { id: true, name: true } });
  await writeAudit({
    userId: admin.id,
    action: "create",
    entityType: "customer_group",
    entityId: group.id,
    after: { name: group.name },
  });
  revalidatePath("/customer-groups");
  return { id: group.id, name: group.name };
}

export async function createQuickCustomerTagAction(data: { name: string }): Promise<QuickResult> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { error: "仅管理员可创建客户标签" };
  const name = data.name?.trim() ?? "";
  if (!name || name.length > 30) return { error: "标签名称不能为空（≤30 字）" };
  const dup = await prisma.customerTag.findUnique({ where: { name } });
  if (dup) return { error: "标签已存在" };
  const tag = await prisma.customerTag.create({ data: { name }, select: { id: true, name: true } });
  await writeAudit({
    userId: admin.id,
    action: "create",
    entityType: "customer_tag",
    entityId: tag.id,
    after: { name: tag.name },
  });
  revalidatePath("/customer-tags");
  return { id: tag.id, name: tag.name };
}

export async function deleteCustomerGroupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
  const id = Number(formData.get("id"));
  const group = await prisma.customerGroup.findUnique({
    where: { id },
    include: { _count: { select: { customers: true } } },
  });
  if (!group) return { error: "组织不存在" };
  if (group._count.customers > 0) {
    return { error: `组织下已有 ${group._count.customers} 个客户，不可删除，请停用` };
  }
  await prisma.customerGroup.delete({ where: { id } });
  await writeAudit({
    userId: admin.id,
    action: "delete",
    entityType: "customer_group",
    entityId: id,
    before: { name: group.name },
  });
  revalidatePath("/customer-groups");
  return { ok: "已删除" };
}

export async function deleteCustomerTagAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
  const id = Number(formData.get("id"));
  const tag = await prisma.customerTag.findUnique({
    where: { id },
    include: { _count: { select: { links: true } } },
  });
  if (!tag) return { error: "标签不存在" };
  if (tag._count.links > 0) {
    return { error: `标签已挂在 ${tag._count.links} 个客户下，不可删除，请停用` };
  }
  await prisma.customerTag.delete({ where: { id } });
  await writeAudit({
    userId: admin.id,
    action: "delete",
    entityType: "customer_tag",
    entityId: id,
    before: { name: tag.name },
  });
  revalidatePath("/customer-tags");
  return { ok: "已删除" };
}

export async function saveCustomerGroupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
  const idRaw = formData.get("id");
  const id = idRaw ? Number(idRaw) : null;
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 50) return { error: "组织名称不能为空（≤50 字）" };
  const dup = await prisma.customerGroup.findFirst({ where: { name, ...(id ? { NOT: { id } } : {}) } });
  if (dup) return { error: "组织已存在" };
  if (id) {
    const before = await prisma.customerGroup.findUnique({ where: { id } });
    if (!before) return { error: "组织不存在" };
    await prisma.customerGroup.update({ where: { id }, data: { name } });
    await writeAudit({
      userId: admin.id,
      action: "update",
      entityType: "customer_group",
      entityId: id,
      before: { name: before.name },
      after: { name },
    });
  } else {
    const group = await prisma.customerGroup.create({ data: { name } });
    await writeAudit({
      userId: admin.id,
      action: "create",
      entityType: "customer_group",
      entityId: group.id,
      after: { name: group.name },
    });
  }
  revalidatePath("/customer-groups");
  return { ok: id ? "已更新" : "组织创建成功" };
}

export async function toggleCustomerGroupStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
  const id = Number(formData.get("id"));
  const group = await prisma.customerGroup.findUnique({ where: { id } });
  if (!group) return { error: "组织不存在" };
  const next = group.status === 1 ? 0 : 1;
  await prisma.customerGroup.update({ where: { id }, data: { status: next } });
  await writeAudit({
    userId: admin.id,
    action: "update",
    entityType: "customer_group",
    entityId: id,
    before: { name: group.name, status: group.status },
    after: { name: group.name, status: next },
  });
  revalidatePath("/customer-groups");
  return { ok: next === 1 ? "已启用" : "已停用" };
}

export async function saveCustomerTagAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
  const idRaw = formData.get("id");
  const id = idRaw ? Number(idRaw) : null;
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 30) return { error: "标签名称不能为空（≤30 字）" };
  const dup = await prisma.customerTag.findFirst({ where: { name, ...(id ? { NOT: { id } } : {}) } });
  if (dup) return { error: "标签已存在" };
  if (id) {
    const before = await prisma.customerTag.findUnique({ where: { id } });
    if (!before) return { error: "标签不存在" };
    await prisma.customerTag.update({ where: { id }, data: { name } });
    await writeAudit({
      userId: admin.id,
      action: "update",
      entityType: "customer_tag",
      entityId: id,
      before: { name: before.name },
      after: { name },
    });
  } else {
    const tag = await prisma.customerTag.create({ data: { name } });
    await writeAudit({
      userId: admin.id,
      action: "create",
      entityType: "customer_tag",
      entityId: tag.id,
      after: { name: tag.name },
    });
  }
  revalidatePath("/customer-tags");
  return { ok: id ? "已更新" : "标签创建成功" };
}

export async function toggleCustomerTagStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
  const id = Number(formData.get("id"));
  const tag = await prisma.customerTag.findUnique({ where: { id } });
  if (!tag) return { error: "标签不存在" };
  const next = tag.status === 1 ? 0 : 1;
  await prisma.customerTag.update({ where: { id }, data: { status: next } });
  await writeAudit({
    userId: admin.id,
    action: "update",
    entityType: "customer_tag",
    entityId: id,
    before: { name: tag.name, status: tag.status },
    after: { name: tag.name, status: next },
  });
  revalidatePath("/customer-tags");
  return { ok: next === 1 ? "已启用" : "已停用" };
}

/** 删除客户：未被任何售卖/退货单引用才可删（引用关系建议用停用）。 */
export async function deleteCustomerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
  const id = Number(formData.get("id"));
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) return { error: "客户不存在" };
  const [soCount, srCount] = await Promise.all([
    prisma.saleOrder.count({ where: { customerId: id } }),
    prisma.saleReturn.count({ where: { customerId: id } }),
  ]);
  if (soCount + srCount > 0) {
    return { error: `该客户已有 ${soCount + srCount} 张单据，不可删除，请停用` };
  }
  await prisma.customer.delete({ where: { id } }); // tagLinks 级联删除
  await writeAudit({
    userId: admin.id,
    action: "delete",
    entityType: "customer",
    entityId: id,
    before: { name: customer.name },
  });
  revalidatePath("/customers");
  return { ok: "已删除" };
}
