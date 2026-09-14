import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { pinyinQuery } from "@/lib/pinyin";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 库存查询服务（CLI 与网页库存页共用）。
 *
 * 这里有一条**单一来源**的预警判定 `warningProductIds()`：库存页原来是在
 * "已分页的当前页"上做 JS 过滤来算"预警 N 个"，于是这个数字会随翻页变化，
 * 开 warnOnly 后一页还显示不满。改成两处都走这个 SQL 谓词后，
 * 计数与筛选都在数据库里完成，分页口径才对得上。
 *
 * 口径其余部分照抄 src/app/(main)/inventory/page.tsx（改动必须同步改页面）：
 * - 排序 code 升序，每页 50 条（与页面一致）
 * - 分类 / 厂家 / 进货时间都下推数据库
 * - 库存数量与金额都是 Product 上的冗余列（没有现场聚合）
 */

export const INVENTORY_PAGE_SIZE = 50;

/** 低库存谓词（**唯一**定义）：启用中 + 设了预警线 + 库存低于预警线 */
const WARNING_SQL = Prisma.sql`status = 1 AND min_stock > 0 AND stock_qty < min_stock`;

/** 低库存商品 id 集合：库存页的"预警 N 个"与 CLI 的 --warn-only 都用它 */
export async function warningProductIds(): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ id: number }[]>(
    Prisma.sql`SELECT id FROM products WHERE ${WARNING_SQL}`
  );
  return rows.map((r) => r.id);
}

const inputSchema = z.object({
  q: z.string().trim().max(50).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
  warnOnly: z.coerce.boolean().optional(),
  /** 分类 id；"none" = 未分类 */
  category: z.union([z.coerce.number().int().positive(), z.literal("none")]).optional(),
  /** 厂家名；"none" = 未填厂家 */
  manufacturer: z.union([z.string().trim().min(1).max(100), z.literal("none")]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from 应为 YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to 应为 YYYY-MM-DD").optional(),
});

export type ListInventoryInput = z.input<typeof inputSchema>;

export interface InventoryRow {
  id: number;
  code: string;
  name: string;
  manufacturer: string;
  category: string | null;
  unit: string;
  status: number;
  stockQty: string;
  stockAmount: string;
  avgCost: string;
  minStock: string;
  refSalePrice: string;
  refPurchasePrice: string;
  /** 启用中且低于预警线（与页面同一个谓词） */
  warning: boolean;
  /** 库存为负：正常业务不允许，出现就是异常数据，值得在 CLI 里显眼 */
  negative: boolean;
}

export interface InventoryListResult {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** 全部时间下的预警商品总数（与当前页无关）——页面顶部"预警商品 N 个"用的就是它 */
  warningCount: number;
  applied: Record<string, unknown>;
  rows: InventoryRow[];
}

export async function listInventory(
  _actor: Actor,
  rawInput: ListInventoryInput
): Promise<CliResult<InventoryListResult>> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const input = parsed.data;

  const pageSize = input.pageSize ?? INVENTORY_PAGE_SIZE;
  const page = Math.max(1, input.page ?? 1);
  const fromDate = input.from ? new Date(`${input.from}T00:00:00`) : undefined;
  const toDate = input.to ? new Date(`${input.to}T23:59:59.999`) : undefined;
  const hasDateFilter = fromDate != null || toDate != null;

  // 预警集合只查一次：既用于 --warn-only 的筛选，也用于行标记与全局计数
  const warnIds = await warningProductIds();
  const warningIdSet = new Set(warnIds);

  const where: Prisma.ProductWhereInput = {
    ...(input.q
      ? {
          OR: [
            { name: { contains: input.q } },
            { code: { contains: input.q } },
            { searchPinyin: { contains: pinyinQuery(input.q) } },
          ],
        }
      : {}),
    ...(input.category === "none" ? { categoryId: null } : typeof input.category === "number" ? { categoryId: input.category } : {}),
    ...(input.manufacturer === "none" ? { manufacturer: "" } : input.manufacturer ? { manufacturer: input.manufacturer } : {}),
    ...(hasDateFilter
      ? {
          stockMovements: {
            some: {
              bizType: "purchase_in",
              ...(fromDate || toDate ? { createdAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}),
            },
          },
        }
      : {}),
    ...(input.warnOnly ? { id: { in: warnIds } } : {}),
  };

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { code: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { unit: { select: { name: true } }, category: { select: { name: true } } },
    }),
  ]);

  const rows: InventoryRow[] = products.map((p) => {
    const qty = Number(p.stockQty);
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      manufacturer: p.manufacturer,
      category: p.category?.name ?? null,
      unit: p.unit.name,
      status: p.status,
      stockQty: qty.toFixed(3),
      stockAmount: Number(p.stockAmount).toFixed(2),
      avgCost: Number(p.avgCost).toFixed(4),
      minStock: Number(p.minStock).toFixed(3),
      refSalePrice: Number(p.refSalePrice).toFixed(2),
      refPurchasePrice: Number(p.refPurchasePrice).toFixed(2),
      warning: warningIdSet.has(p.id),
      negative: qty < 0,
    };
  });

  return ok({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    warningCount: warnIds.length,
    applied: {
      q: input.q ?? null,
      warnOnly: input.warnOnly ?? false,
      category: input.category ?? null,
      manufacturer: input.manufacturer ?? null,
      from: input.from ?? null,
      to: input.to ?? null,
      orderBy: "code asc",
    },
    rows,
  });
}
