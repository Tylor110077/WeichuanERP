"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireMasterDataWrite } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";

const productSchema = z.object({
  name: z.string().trim().min(1, "请填写商品名称").max(100),
  spec: z.string().trim().max(100),
  manufacturer: z.string().trim().min(1, "请填厂商/生产厂家").max(100), // 必填
  categoryId: z.coerce.number().int().positive().nullable(),
  unitId: z.coerce.number().int().positive("请选择单位"),
  refPurchasePrice: z.coerce.number().min(0).max(9_999_999_999.99),
  refSalePrice: z.coerce.number().min(0).max(9_999_999_999.99),
  minStock: z.coerce.number().min(0).max(9_999_999_999.999),
});

export type FormState = { error?: string; ok?: string } | null;

function parseProduct(formData: FormData) {
  const catRaw = formData.get("categoryId");
  return productSchema.safeParse({
    name: formData.get("name") ?? "",
    spec: formData.get("spec") ?? "",
    manufacturer: formData.get("manufacturer") ?? "",
    categoryId: catRaw ? Number(catRaw) : null,
    unitId: Number(formData.get("unitId")),
    refPurchasePrice: formData.get("refPurchasePrice") ?? 0,
    refSalePrice: formData.get("refSalePrice") ?? 0,
    minStock: formData.get("minStock") ?? 0,
  });
}

/** 自动 SKU：P + 6 位序号（基于当前最大 id + 1），唯一索引兜底防重号 */
async function generateUniqueCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const last = await prisma.product.findFirst({
      orderBy: { id: "desc" },
      select: { id: true },
    });
    const code = `P${String((last?.id ?? 0) + 1).padStart(6, "0")}`;
    const exists = await prisma.product.findUnique({ where: { code } });
    if (!exists) return code;
  }
  throw new Error("商品编码生成失败，请重试");
}

async function guardAdmin() {
  return requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
}

export async function saveProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await guardAdmin();
  const idRaw = formData.get("id");
  const id = idRaw ? Number(idRaw) : null;
  const parsed = parseProduct(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  }
  const { categoryId, ...data } = parsed.data;

  const writeData = {
    name: data.name,
    spec: data.spec || null,
    manufacturer: data.manufacturer,
    categoryId,
    unitId: data.unitId,
    refPurchasePrice: data.refPurchasePrice,
    refSalePrice: data.refSalePrice,
    minStock: data.minStock,
  };

  if (id) {
    const before = await prisma.product.findUnique({ where: { id } });
    if (!before) return { error: "商品不存在" };
    await prisma.product.update({ where: { id }, data: writeData });
    await writeAudit({
      userId: admin.id,
      action: "update",
      entityType: "product",
      entityId: id,
      before: {
        code: before.code,
        name: before.name,
        spec: before.spec,
        manufacturer: before.manufacturer,
        refPurchasePrice: Number(before.refPurchasePrice),
        refSalePrice: Number(before.refSalePrice),
        minStock: Number(before.minStock),
      },
      after: {
        code: before.code,
        name: writeData.name,
        spec: writeData.spec,
        manufacturer: writeData.manufacturer,
        refPurchasePrice: writeData.refPurchasePrice,
        refSalePrice: writeData.refSalePrice,
        minStock: writeData.minStock,
      },
    });
  } else {
    let created: { id: number; code: string; name: string } | null = null;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      const code = await generateUniqueCode();
      try {
        created = await prisma.product.create({
          data: { ...writeData, code },
          select: { id: true, code: true, name: true },
        });
      } catch (err) {
        // P2002: 编码唯一冲突（并发），重取序号重试
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          continue;
        }
        throw err;
      }
    }
    if (!created) return { error: "商品创建失败，请重试" };
    await writeAudit({
      userId: admin.id,
      action: "create",
      entityType: "product",
      entityId: created.id,
      after: { ...writeData, code: created.code },
    });
  }
  revalidatePath("/products");
  return { ok: id ? "已更新" : "商品创建成功" };
}

export async function toggleProductStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await guardAdmin();
  const id = Number(formData.get("id"));
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return { error: "商品不存在" };
  const next = product.status === 1 ? 0 : 1;
  await prisma.product.update({ where: { id }, data: { status: next } });
  await writeAudit({
    userId: admin.id,
    action: "update",
    entityType: "product",
    entityId: id,
    before: { code: product.code, status: product.status },
    after: { code: product.code, status: next },
  });
  revalidatePath("/products");
  return { ok: next === 1 ? "已启用" : "已停用" };
}

export type QuickProductResult =
  | {
      id: number;
      code: string;
      name: string;
      manufacturer: string;
      unitId: number;
      unitName: string;
      refSalePrice: number;
      refPurchasePrice: number;
    }
  | { error: string };

/** 销售开单页内直接新建商品（仅管理员；SKU 自动生成，同商品管理页）。 */
export async function createQuickProductAction(data: {
  name: string;
  spec?: string;
  manufacturer: string; // 必填：厂商/生产厂家
  categoryId?: number | null;
  unitId: number;
  refPurchasePrice?: number | null;
  refSalePrice?: number | null;
  minStock?: number | null;
}): Promise<QuickProductResult> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { error: "仅管理员可在开单页新建商品" };

  const parsed = productSchema.safeParse({
    name: data.name ?? "",
    spec: data.spec ?? "",
    manufacturer: data.manufacturer ?? "",
    categoryId: data.categoryId || null,
    unitId: Number(data.unitId),
    refPurchasePrice: data.refPurchasePrice ?? 0,
    refSalePrice: data.refSalePrice ?? 0,
    minStock: data.minStock ?? 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "输入有误" };

  const unit = await prisma.unit.findUnique({ where: { id: parsed.data.unitId } });
  if (!unit || unit.status !== 1) return { error: "单位不存在或已停用" };

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await generateUniqueCode();
    try {
      const product = await prisma.product.create({
        data: {
          code,
          name: parsed.data.name,
          spec: parsed.data.spec || null,
          manufacturer: parsed.data.manufacturer,
          categoryId: parsed.data.categoryId,
          unitId: parsed.data.unitId,
          refPurchasePrice: parsed.data.refPurchasePrice,
          refSalePrice: parsed.data.refSalePrice,
          minStock: parsed.data.minStock,
          createdBy: admin.id,
        },
        select: { id: true, code: true, name: true },
      });
      await writeAudit({
        userId: admin.id,
        action: "create",
        entityType: "product",
        entityId: product.id,
        after: { code, name: parsed.data.name, quickCreate: true },
      });
      revalidatePath("/products");
      return {
        id: product.id,
        code: product.code,
        name: product.name,
        manufacturer: parsed.data.manufacturer,
        unitId: parsed.data.unitId,
        unitName: unit.name,
        refSalePrice: parsed.data.refSalePrice,
        refPurchasePrice: parsed.data.refPurchasePrice,
      };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  return { error: "商品编码生成失败，请重试" };
}
