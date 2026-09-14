import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { dateRange } from "@/lib/reports";
import { STOCK_BIZ_TYPE_LABELS } from "@/lib/stock-labels";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 库存流水查询服务。
 *
 * 口径照抄 src/app/(main)/stock-movements/page.tsx：时间倒序、每页 20、
 * 商品/类型/时间三个筛选都下推数据库；sales 角色无权限（与页面一致）。
 *
 * 流水的 bizType 与金额含义（写 CLI 文档时要讲清，否则容易被误读）：
 * changeQty 正数=入库、负数=出库；unitCost 是**当次**的单价，
 * 出库/冲回时用的是当时的移动加权均价（不是原单快照价）。
 */

const PAGE = 20;

const inputSchema = z.object({
  productId: z.coerce.number().int().positive().optional(),
  bizType: z.enum(["purchase_in", "sale_out", "purchase_return_out", "sale_return_in", "void_reverse"]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from 应为 YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to 应为 YYYY-MM-DD").optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
});

export type ListStockMovementsInput = z.input<typeof inputSchema>;

const day = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function listStockMovements(
  actor: Actor,
  rawInput: ListStockMovementsInput
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role === "sales") return fail("FORBIDDEN", "无权限访问库存流水（管理员/老板）");
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const input = parsed.data;

  const page = Math.max(1, input.page ?? 1);
  const pageSize = input.pageSize ?? PAGE;
  const range = dateRange(input.from, input.to);

  const where = {
    ...(input.productId ? { productId: input.productId } : {}),
    ...(input.bizType ? { bizType: input.bizType } : {}),
    createdAt: { gte: range.gte, lte: range.lte },
  };

  const [total, movements, sums] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { product: { select: { code: true, name: true } } },
    }),
    // 合计用 SQL 聚合：拿当前页求和会随翻页变化（本页早些时候刚修过同类问题）
    prisma.stockMovement.aggregate({ where, _sum: { changeQty: true } }),
  ]);

  return ok({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    /** 区间内净变动（正=净入库；分正负流量混在一起看意义有限，故只给净额） */
    netChangeQty: Number(sums._sum.changeQty ?? 0).toFixed(3),
    applied: {
      from: day(range.gte),
      to: day(range.lte),
      productId: input.productId ?? null,
      bizType: input.bizType ?? null,
      orderBy: "createdAt desc",
    },
    rows: movements.map((m) => ({
      id: m.id,
      date: day(m.createdAt),
      productCode: m.product.code,
      productName: m.product.name,
      bizType: m.bizType,
      bizTypeLabel: STOCK_BIZ_TYPE_LABELS[m.bizType] ?? m.bizType,
      bizOrderNo: m.bizOrderNo,
      changeQty: Number(m.changeQty).toFixed(3),
      beforeQty: Number(m.beforeQty).toFixed(3),
      afterQty: Number(m.afterQty).toFixed(3),
      unitCost: Number(m.unitCost).toFixed(4),
      amount: (Number(m.changeQty) * Number(m.unitCost)).toFixed(2),
    })),
  });
}
