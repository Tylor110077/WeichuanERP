"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireMasterDataWrite } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";

const unitSchema = z.object({
  name: z.string().trim().min(1, "请填写单位名称").max(20),
});

type FormState = { error?: string; ok?: string } | null;

export async function saveUnitAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });

  const idRaw = formData.get("id");
  const id = idRaw ? Number(idRaw) : null;
  const parsed = unitSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const { name } = parsed.data;

  const dup = await prisma.unit.findFirst({
    where: { name, ...(id ? { NOT: { id } } : {}) },
  });
  if (dup) return { error: "单位名称已存在" };

  if (id) {
    const before = await prisma.unit.findUnique({ where: { id } });
    if (!before) return { error: "单位不存在" };
    await prisma.unit.update({ where: { id }, data: { name } });
    await writeAudit({
      userId: admin.id,
      action: "update",
      entityType: "unit",
      entityId: id,
      before: { name: before.name },
      after: { name },
    });
  } else {
    const unit = await prisma.unit.create({ data: { name } });
    await writeAudit({
      userId: admin.id,
      action: "create",
      entityType: "unit",
      entityId: unit.id,
      after: { name: unit.name },
    });
  }
  revalidatePath("/units");
  return { ok: id ? "已更新" : "单位创建成功" };
}

export async function toggleUnitStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
  const id = Number(formData.get("id"));
  const unit = await prisma.unit.findUnique({ where: { id } });
  if (!unit) return { error: "单位不存在" };
  const next = unit.status === 1 ? 0 : 1;
  await prisma.unit.update({ where: { id }, data: { status: next } });
  await writeAudit({
    userId: admin.id,
    action: "update",
    entityType: "unit",
    entityId: id,
    before: { name: unit.name, status: unit.status },
    after: { name: unit.name, status: next },
  });
  revalidatePath("/units");
  return { ok: next === 1 ? "已启用" : "已停用" };
}

export async function deleteUnitAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
  const id = Number(formData.get("id"));
  const unit = await prisma.unit.findUnique({
    where: { id },
    include: { _count: { select: { products: true } } },
  });
  if (!unit) return { error: "单位不存在" };
  if (unit._count.products > 0) {
    return { error: `该单位已被 ${unit._count.products} 个商品引用，不可删除，请停用` };
  }
  await prisma.unit.delete({ where: { id } });
  await writeAudit({
    userId: admin.id,
    action: "delete",
    entityType: "unit",
    entityId: id,
    before: { name: unit.name },
  });
  revalidatePath("/units");
  return { ok: "已删除" };
}
