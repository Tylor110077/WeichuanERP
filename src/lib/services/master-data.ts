import { z } from "zod";
import { zBoolean } from "@/lib/form-bool";
import { prisma } from "@/lib/prisma";
import { pinyinQuery } from "@/lib/pinyin";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 主数据只读查询（CLI 与网页共用口径）。
 *
 * 这批命令存在的意义：**Agent 开单/补货时要先把名字换成 id**。
 * 让人去翻页面找 id 不现实，让 Agent 猜更不行。
 *
 * 口径照抄对应页面，改动必须同步改：
 * - 商品：src/app/(main)/products/page.tsx（code 升序、每页 50、厂家/分类/搜索都下推数据库）
 * - 客户：src/app/(main)/customers/page.tsx（createdAt 升序、每页 50、名称/电话/拼音）
 * - 厂家：同商品页（supplier 表 + 按厂家名统计商品数）
 */

const PAGE = 50;

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
  q: z.string().trim().max(50).optional(),
});

const money = (n: number) => n.toFixed(2);
const qty = (n: number) => n.toFixed(3);

function paging(input: { page?: number; pageSize?: number }) {
  const pageSize = input.pageSize ?? PAGE;
  const page = Math.max(1, input.page ?? 1);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/* ------------------------------------------------------------------ 商品 */

const productSchema = pageSchema.extend({
  /** 分类 id；"none" = 未分类 */
  category: z.union([z.coerce.number().int().positive(), z.literal("none")]).optional(),
  /** 厂家名；"none" = 未填厂家 */
  manufacturer: z.union([z.string().trim().min(1).max(100), z.literal("none")]).optional(),
  /** status=1 只看启用；默认全部（含停用），与页面一致 */
  enabledOnly: zBoolean().optional(),
});

export type ListProductsInput = z.input<typeof productSchema>;

export async function listProducts(
  _actor: Actor,
  rawInput: ListProductsInput
): Promise<CliResult<Record<string, unknown>>> {
  const parsed = productSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const input = parsed.data;
  const { page, pageSize, skip, take } = paging(input);

  const where = {
    ...(input.manufacturer === "none" ? { manufacturer: "" } : input.manufacturer ? { manufacturer: input.manufacturer } : {}),
    ...(input.category === "none" ? { categoryId: null } : typeof input.category === "number" ? { categoryId: input.category } : {}),
    ...(input.enabledOnly ? { status: 1 } : {}),
    ...(input.q
      ? {
          OR: [
            { name: { contains: input.q } },
            { code: { contains: input.q } },
            { manufacturer: { contains: input.q } },
            { searchPinyin: { contains: pinyinQuery(input.q) } },
          ],
        }
      : {}),
  };

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { code: "asc" },
      skip,
      take,
      include: { category: { select: { name: true } }, unit: { select: { name: true } } },
    }),
  ]);

  return ok({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    applied: {
      q: input.q ?? null,
      category: input.category ?? null,
      manufacturer: input.manufacturer ?? null,
      enabledOnly: input.enabledOnly ?? false,
      orderBy: "code asc",
    },
    rows: products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      manufacturer: p.manufacturer,
      category: p.category?.name ?? null,
      unit: p.unit.name,
      stockQty: qty(Number(p.stockQty)),
      minStock: qty(Number(p.minStock)),
      refPurchasePrice: money(Number(p.refPurchasePrice)),
      refSalePrice: money(Number(p.refSalePrice)),
      status: p.status,
    })),
  });
}

/* ------------------------------------------------------------------ 客户 */

const customerSchema = pageSchema.extend({
  /** 分组 id；"none" = 未分组 */
  groupId: z.union([z.coerce.number().int().positive(), z.literal("none")]).optional(),
  tagId: z.coerce.number().int().positive().optional(),
});

export type ListCustomersInput = z.input<typeof customerSchema>;

export async function listCustomers(
  _actor: Actor,
  rawInput: ListCustomersInput
): Promise<CliResult<Record<string, unknown>>> {
  const parsed = customerSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const input = parsed.data;
  const { page, pageSize, skip, take } = paging(input);

  const where = {
    ...(input.groupId === "none" ? { groupId: null } : typeof input.groupId === "number" ? { groupId: input.groupId } : {}),
    ...(input.tagId ? { tagLinks: { some: { tagId: input.tagId } } } : {}),
    ...(input.q
      ? {
          OR: [
            { name: { contains: input.q } },
            { phone: { contains: input.q } },
            { searchPinyin: { contains: pinyinQuery(input.q) } },
          ],
        }
      : {}),
  };

  const [total, customers, allTotal] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip,
      take,
      include: {
        group: { select: { id: true, name: true } },
        tagLinks: { include: { tag: { select: { id: true, name: true } } } },
      },
    }),
    // 左栏计数用全量：数字不该随搜索词变化（与页面同口径）
    prisma.customer.count(),
  ]);

  return ok({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    /** 全部客户数（与当前筛选无关），对应页面的左栏计数 */
    allTotal,
    applied: { q: input.q ?? null, groupId: input.groupId ?? null, tagId: input.tagId ?? null, orderBy: "createdAt asc" },
    rows: customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone ?? "",
      address: c.address ?? "",
      remark: c.remark ?? "",
      group: c.group?.name ?? null,
      tags: c.tagLinks.map((l) => l.tag.name),
      status: c.status,
    })),
  });
}

/* ------------------------------------------------------------------ 厂家 */

const supplierSchema = pageSchema.extend({
  status: z.coerce.number().int().min(0).max(1).optional(),
});

export type ListSuppliersInput = z.input<typeof supplierSchema>;

export async function listSuppliers(
  _actor: Actor,
  rawInput: ListSuppliersInput
): Promise<CliResult<Record<string, unknown>>> {
  const parsed = supplierSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const input = parsed.data;
  const { page, pageSize, skip, take } = paging(input);

  const where = {
    ...(input.status != null ? { status: input.status } : {}),
    ...(input.q
      ? {
          OR: [
            { name: { contains: input.q } },
            { contact: { contains: input.q } },
            { searchPinyin: { contains: pinyinQuery(input.q) } },
          ],
        }
      : {}),
  };

  // 每个厂家供着多少商品：商品表按"厂家名"关联（manufacturer 是自由字符串，不是外键）
  const [total, suppliers, mfrGroups] = await Promise.all([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({ where, orderBy: { createdAt: "asc" }, skip, take }),
    prisma.product.groupBy({ by: ["manufacturer"], _count: { _all: true } }),
  ]);
  const countByName = new Map<string, number>();
  for (const g of mfrGroups) {
    // 累加而不是覆盖：厂家名可能带空格，trim 后重名（" 中电" 与 "中电"）会分组到两次，
    // 覆盖会让其中一个的商品数凭空消失（商品页那边同样是累加）
    const key = g.manufacturer.trim();
    countByName.set(key, (countByName.get(key) ?? 0) + g._count._all);
  }

  return ok({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    applied: { q: input.q ?? null, status: input.status ?? null, orderBy: "createdAt asc" },
    rows: suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      contact: s.contact ?? "",
      phone: s.phone ?? "",
      address: s.address ?? "",
      remark: s.remark ?? "",
      /** 该厂家名下的商品数（按名字匹配，见商品表 manufacturer 字段） */
      productCount: countByName.get(s.name.trim()) ?? 0,
      status: s.status,
    })),
  });
}

/* ------------------------------------------------------- 单位 / 分类 */

export async function listUnits(_actor: Actor, rawInput: unknown): Promise<CliResult<Record<string, unknown>>> {
  const parsed = pageSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const input = parsed.data;
  const where = input.q ? { name: { contains: input.q } } : {};
  const [total, rows] = await Promise.all([
    prisma.unit.count({ where }),
    prisma.unit.findMany({ where, orderBy: { name: "asc" }, select: { id: true, name: true, status: true, _count: { select: { products: true } } } }),
  ]);
  return ok({
    total,
    applied: { q: input.q ?? null, orderBy: "name asc" },
    rows: rows.map((u) => ({ id: u.id, name: u.name, status: u.status, productCount: u._count.products })),
  });
}

export async function listCategories(_actor: Actor, rawInput: unknown): Promise<CliResult<Record<string, unknown>>> {
  const parsed = pageSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const input = parsed.data;
  const where = input.q ? { name: { contains: input.q } } : {};
  const [total, rows] = await Promise.all([
    prisma.productCategory.count({ where }),
    prisma.productCategory.findMany({ where, orderBy: { name: "asc" }, select: { id: true, name: true, status: true, _count: { select: { products: true } } } }),
  ]);
  return ok({
    total,
    applied: { q: input.q ?? null, orderBy: "name asc" },
    rows: rows.map((c) => ({ id: c.id, name: c.name, status: c.status, productCount: c._count.products })),
  });
}
