"use server";

import { revalidatePath } from "next/cache";
import { initials } from "@/lib/pinyin-server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireMasterDataWrite } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";

const productSchema = z.object({
  name: z.string().trim().min(1, "请填写商品名称（写全名称，如 BV 2.5平方 单芯铜线）").max(100),
  manufacturer: z.string().trim().min(1, "请选择或新建厂家").max(100), // 必填（厂家档案）
  categoryId: z.coerce.number().int().positive().nullable(),
  unitId: z.coerce.number().int().positive("请选择单位"),
  refPurchasePrice: z.coerce.number().min(0).max(9_999_999_999.99),
  refSalePrice: z.coerce.number().min(0).max(9_999_999_999.99).optional().default(0),
  // 预警线默认 1（不填即 1）
  minStock: z.preprocess(
    (v) => (v === "" || v == null ? 1 : v),
    z.coerce.number().min(0).max(9_999_999_999.999)
  ),
});

export type FormState = { error?: string; ok?: string } | null;

function parseProduct(formData: FormData) {
  const catRaw = formData.get("categoryId");
  return productSchema.safeParse({
    name: formData.get("name") ?? "",
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

/**
 * 估价行的占位商品：开单时连商品是什么都还没定，只给一个临时名字先把单开出来。
 * 建的是普通商品（编码照常生成、单位取第一个启用的），
 * 补单时在「估价待补单」里把名字与厂家改成真实的即可。
 */
export async function createPlaceholderProductAction(
  name: string
): Promise<{ id: number; code: string; name: string; unitName: string; py: string } | { error: string }> {
  const user = await requireMasterDataWrite().catch(() => null);
  if (!user) return { error: "无权限新建商品" };
  const trimmed = name.trim().slice(0, 100);
  if (!trimmed) return { error: "请填写临时品名" };

  const unit = await prisma.unit.findFirst({
    where: { status: 1 },
    orderBy: { id: "asc" },
    select: { id: true, name: true },
  });
  if (!unit) return { error: "还没有计量单位，请先到「计量单位」里建一个" };

  const created = await prisma.product.create({
    data: { code: await generateUniqueCode(), name: trimmed, unitId: unit.id, refPurchasePrice: 0, refSalePrice: 0, status: 1 },
    select: { id: true, code: true, name: true },
  });
  await writeAudit({
    userId: user.id,
    action: "create",
    entityType: "product",
    entityId: created.id,
    after: { code: created.code, name: trimmed, placeholder: true },
  });
  revalidatePath("/products");
  return {
    id: created.id,
    code: created.code,
    name: created.name,
    unitName: unit.name,
    // 下拉候选按"编码 + 名称 +（厂家）"搜，这里跟着算好拼音首字母，客户端就不用带拼音词典
    py: initials(`${created.code} ${created.name}`),
  };
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
        manufacturer: before.manufacturer,
        refPurchasePrice: Number(before.refPurchasePrice),
        refSalePrice: Number(before.refSalePrice),
        minStock: Number(before.minStock),
      },
      after: {
        code: before.code,
        name: writeData.name,
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
  redirect("/products");
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
      /** 拼音首字母（下拉候选本地过滤用，服务端算好下发） */
      py: string;
      refSalePrice: number;
      refPurchasePrice: number;
    }
  | { error: string };

/** 销售开单页内直接新建商品（仅管理员；SKU 自动生成，同商品管理页）。 */
export async function createQuickProductAction(data: {
  name: string;
  manufacturer: string; // 必填：厂家
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
        // 下拉候选按「编码 + 名称 +（厂家）」搜：跟着算好拼音首字母，客户端就不用带拼音词典
        py: initials(`${product.code} ${product.name}（${parsed.data.manufacturer || "未填厂家"}）`),
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


/** 删除商品：未被任何单据/流水引用才可删（引用关系建议用停用）。 */
export async function deleteProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => {
    throw new Error("无权限执行此操作");
  });
  const id = Number(formData.get("id"));
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return { error: "商品不存在" };
  const [po, so, pr, sr, sm] = await Promise.all([
    prisma.purchaseOrderItem.count({ where: { productId: id } }),
    prisma.saleOrderItem.count({ where: { productId: id } }),
    prisma.purchaseReturnItem.count({ where: { productId: id } }),
    prisma.saleReturnItem.count({ where: { productId: id } }),
    prisma.stockMovement.count({ where: { productId: id } }),
  ]);
  const refs = po + so + pr + sr + sm;
  if (refs > 0) {
    return { error: `该商品已出现在 ${refs} 处单据/流水中，不可删除，请停用` };
  }
  await prisma.product.delete({ where: { id } });
  await writeAudit({
    userId: admin.id,
    action: "delete",
    entityType: "product",
    entityId: id,
    before: { code: product.code, name: product.name },
  });
  revalidatePath("/products");
  return { ok: "已删除" };
}
