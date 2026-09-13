"use server";

import { revalidatePath } from "next/cache";
import { initials } from "@/lib/pinyin-server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireMasterDataWrite } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";

const supplierSchema = z.object({
  name: z.string().trim().min(1, "请填写厂家名称").max(100),
  contact: z.string().trim().max(50),
  phone: z.string().trim().max(30),
  address: z.string().trim().max(200),
  remark: z.string().trim().max(200),
});

export type FormState = { error?: string; ok?: string } | null;

type SupplierData = z.infer<typeof supplierSchema>;

function parseSupplier(formData: FormData): SupplierData | { error: string } {
  const parsed = supplierSchema.safeParse({
    name: formData.get("name") ?? "",
    contact: formData.get("contact") ?? "",
    phone: formData.get("phone") ?? "",
    address: formData.get("address") ?? "",
    remark: formData.get("remark") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  return parsed.data;
}

export async function saveSupplierAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
  const idRaw = formData.get("id");
  const id = idRaw ? Number(idRaw) : null;
  const data = parseSupplier(formData);
  if ("error" in data) return { error: data.error };

  if (id) {
    const before = await prisma.supplier.findUnique({ where: { id } });
    if (!before) return { error: "厂家不存在" };
    await prisma.supplier.update({ where: { id }, data });
    await writeAudit({
      userId: admin.id,
      action: "update",
      entityType: "supplier",
      entityId: id,
      before: { name: before.name, contact: before.contact, phone: before.phone },
      after: { name: data.name, contact: data.contact, phone: data.phone },
    });
  } else {
    const supplier = await prisma.supplier.create({ data });
    await writeAudit({
      userId: admin.id,
      action: "create",
      entityType: "supplier",
      entityId: supplier.id,
      after: { name: supplier.name, contact: supplier.contact, phone: supplier.phone },
    });
  }
  revalidatePath("/suppliers");
  redirect("/products"); // 厂家档案已并入「商品与厂家」页
}

export async function toggleSupplierStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
  const id = Number(formData.get("id"));
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) return { error: "厂家不存在" };
  const next = supplier.status === 1 ? 0 : 1;
  await prisma.supplier.update({ where: { id }, data: { status: next } });
  await writeAudit({
    userId: admin.id,
    action: "update",
    entityType: "supplier",
    entityId: id,
    before: { name: supplier.name, status: supplier.status },
    after: { name: supplier.name, status: next },
  });
  revalidatePath("/suppliers");
  return { ok: next === 1 ? "已启用" : "已停用" };
}

/** 删除厂家：未被任何进货/退货单引用才可删（引用关系建议用停用）。 */
export async function deleteSupplierAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
  const id = Number(formData.get("id"));
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) return { error: "厂家不存在" };
  const [poCount, retCount] = await Promise.all([
    prisma.purchaseOrder.count({ where: { supplierId: id } }),
    prisma.purchaseReturn.count({ where: { supplierId: id } }),
  ]);
  if (poCount + retCount > 0) {
    return { error: `该厂家已有 ${poCount + retCount} 张单据，不可删除，请停用` };
  }
  await prisma.supplier.delete({ where: { id } });
  await writeAudit({
    userId: admin.id,
    action: "delete",
    entityType: "supplier",
    entityId: id,
    before: { name: supplier.name },
  });
  revalidatePath("/suppliers");
  return { ok: "已删除" };
}

export type QuickSupplierResult = { id: number; name: string; py: string } | { error: string };

/** 商品建档处的厂家=厂家档案；不存在时按名称快速建档（仅管理员）。 */
export async function createQuickSupplierAction(data: {
  name: string;
}): Promise<QuickSupplierResult> {
  const admin = await requireMasterDataWrite().catch(() => null);
  if (!admin) return { error: "仅管理员可新建厂家" };
  const name = data.name?.trim() ?? "";
  if (!name || name.length > 100) return { error: "厂家名称不能为空（≤100 字）" };
  const dup = await prisma.supplier.findFirst({ where: { name } });
  if (dup) return { error: "该厂家已存在" };
  const supplier = await prisma.supplier.create({ data: { name }, select: { id: true, name: true } });
  await writeAudit({
    userId: admin.id,
    action: "create",
    entityType: "supplier",
    entityId: supplier.id,
    after: { name: supplier.name, fromManufacturer: true },
  });
  revalidatePath("/suppliers");
  return { id: supplier.id, name: supplier.name, py: initials(supplier.name) };
}

/**
 * 独立新建页专用：成功后回列表页。
 * （列表页的内联表单仍用原来的 action——那个不能跳转，它要留在原地刷新表格。）
 */
export async function saveSupplierAndReturnAction(
  prev: FormState,
  formData: FormData
): Promise<FormState> {
  const result = await saveSupplierAction(prev, formData);
  if (result?.error) return result;
  redirect("/products?tab=manufacturers");
}
