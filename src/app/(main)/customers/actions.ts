"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireMasterDataWrite } from "@/lib/auth/guards";
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

  if (id) {
    const before = await prisma.customer.findUnique({ where: { id } });
    if (!before) return { error: "客户不存在" };
    await prisma.customer.update({ where: { id }, data });
    await writeAudit({
      userId: admin.id,
      action: "update",
      entityType: "customer",
      entityId: id,
      before: { name: before.name, contact: before.contact, phone: before.phone },
      after: { name: data.name, contact: data.contact, phone: data.phone },
    });
  } else {
    const customer = await prisma.customer.create({ data });
    await writeAudit({
      userId: admin.id,
      action: "create",
      entityType: "customer",
      entityId: customer.id,
      after: { name: customer.name, contact: customer.contact, phone: customer.phone },
    });
  }
  revalidatePath("/customers");
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
