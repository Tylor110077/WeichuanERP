"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireMasterDataWrite } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";

const categorySchema = z.object({
  name: z.string().trim().min(1, "请填写分类名称").max(50),
});

type FormState = { error?: string; ok?: string } | null;

async function guard() {
  return requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
}

export async function saveCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await guard();
  const idRaw = formData.get("id");
  const id = idRaw ? Number(idRaw) : null;
  const parsed = categorySchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const { name } = parsed.data;
  const dup = await prisma.productCategory.findFirst({
    where: { name, ...(id ? { NOT: { id } } : {}) },
  });
  if (dup) return { error: "分类名称已存在" };

  if (id) {
    const before = await prisma.productCategory.findUnique({ where: { id } });
    if (!before) return { error: "分类不存在" };
    await prisma.productCategory.update({ where: { id }, data: { name } });
    await writeAudit({
      userId: admin.id,
      action: "update",
      entityType: "product_category",
      entityId: id,
      before: { name: before.name },
      after: { name },
    });
  } else {
    const cat = await prisma.productCategory.create({ data: { name } });
    await writeAudit({
      userId: admin.id,
      action: "create",
      entityType: "product_category",
      entityId: cat.id,
      after: { name: cat.name },
    });
  }
  revalidatePath("/categories");
  return { ok: id ? "已更新" : "分类创建成功" };
}

export async function toggleCategoryStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await guard();
  const id = Number(formData.get("id"));
  const cat = await prisma.productCategory.findUnique({ where: { id } });
  if (!cat) return { error: "分类不存在" };
  const next = cat.status === 1 ? 0 : 1;
  await prisma.productCategory.update({ where: { id }, data: { status: next } });
  await writeAudit({
    userId: admin.id,
    action: "update",
    entityType: "product_category",
    entityId: id,
    before: { name: cat.name, status: cat.status },
    after: { name: cat.name, status: next },
  });
  revalidatePath("/categories");
  return { ok: next === 1 ? "已启用" : "已停用" };
}

export async function deleteCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await guard();
  const id = Number(formData.get("id"));
  const cat = await prisma.productCategory.findUnique({
    where: { id },
    include: { _count: { select: { products: true } } },
  });
  if (!cat) return { error: "分类不存在" };
  if (cat._count.products > 0) {
    return { error: `该分类下已有 ${cat._count.products} 个商品，不可删除，请停用` };
  }
  await prisma.productCategory.delete({ where: { id } });
  await writeAudit({
    userId: admin.id,
    action: "delete",
    entityType: "product_category",
    entityId: id,
    before: { name: cat.name },
  });
  revalidatePath("/categories");
  return { ok: "已删除" };
}
