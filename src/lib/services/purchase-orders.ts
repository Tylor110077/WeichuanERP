import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { pinyinQuery } from "@/lib/pinyin";
import { dateRange } from "@/lib/reports";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 进货单的只读查询服务（CLI 与网页列表共用一套口径）。
 *
 * 口径照抄 src/app/(main)/purchase-orders/page.tsx，**改动这里必须同步改页面**：
 * - 默认时间范围：本月 1 日 ~ 今天（dateRange 来自 lib/reports.ts）
 * - 未结清 = 应付 − 已付 − 未作废退货冲减 > 0；**只有 pending/received 参与**（作废单不算欠款）
 * - sales 角色只看得见自己开的单
 */

export const DEFAULT_PAGE_SIZE = 20;

const inputSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  status: z.enum(["pending", "received", "voided"]).optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(50).optional(),
  settle: z.enum(["settled", "unsettled"]).optional(),
  starred: z.coerce.boolean().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from 应为 YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to 应为 YYYY-MM-DD").optional(),
});

export type ListPurchaseOrdersInput = z.input<typeof inputSchema>;

const money = (n: number) => n.toFixed(2);
const day = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface PurchaseOrderListRow {
  id: number;
  orderNo: string;
  supplierName: string;
  status: string;
  sourceType: string;
  totalAmount: string;
  paidAmount: string;
  returned: string;
  outstanding: string;
  starred: boolean;
  operatorName: string;
  operatorRole: string;
  createdAt: string;
  itemLines: number;
}

export interface PurchaseOrderListResult {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  applied: Record<string, unknown>;
  rows: PurchaseOrderListRow[];
}

export async function listPurchaseOrders(
  actor: Actor,
  rawInput: ListPurchaseOrdersInput
): Promise<CliResult<PurchaseOrderListResult>> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const input = parsed.data;

  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  const range = dateRange(input.from, input.to);
  const onlyMine = actor.role === "sales";

  // 付款结清筛选：与页面同一段 SQL（不含已作废单）
  let settleIds: number[] | null = null;
  if (input.settle) {
    const settled = input.settle === "settled";
    const rows = settled
      ? await prisma.$queryRaw<{ id: number }[]>`
          SELECT po.id FROM purchase_orders po
          LEFT JOIN (
            SELECT purchase_order_id, SUM(total_amount) AS t
            FROM purchase_returns WHERE status = 'confirmed' GROUP BY purchase_order_id
          ) pr ON pr.purchase_order_id = po.id
          WHERE po.status IN ('pending', 'received')
            AND (po.total_amount - po.paid_amount - COALESCE(pr.t, 0)) <= 0`
      : await prisma.$queryRaw<{ id: number }[]>`
          SELECT po.id FROM purchase_orders po
          LEFT JOIN (
            SELECT purchase_order_id, SUM(total_amount) AS t
            FROM purchase_returns WHERE status = 'confirmed' GROUP BY purchase_order_id
          ) pr ON pr.purchase_order_id = po.id
          WHERE po.status IN ('pending', 'received')
            AND (po.total_amount - po.paid_amount - COALESCE(pr.t, 0)) > 0`;
    settleIds = rows.map((r) => r.id);
  }

  const where = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.supplierId ? { supplierId: input.supplierId } : {}),
    ...(input.q
      ? {
          OR: [
            { orderNo: { contains: input.q } },
            { supplier: { name: { contains: input.q } } },
            { supplier: { searchPinyin: { contains: pinyinQuery(input.q) } } },
          ],
        }
      : {}),
    ...(settleIds ? { id: { in: settleIds } } : {}),
    ...(input.starred ? { starred: true } : {}),
    createdAt: { gte: range.gte, lte: range.lte },
    ...(onlyMine ? { operatorId: actor.userId } : {}),
  };

  const [total, orders] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (Math.max(1, input.page ?? 1) - 1) * pageSize,
      take: pageSize,
      include: {
        supplier: { select: { name: true } },
        operator: { select: { displayName: true, role: true } },
        returns: { where: { status: "confirmed" }, select: { totalAmount: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);

  const rows: PurchaseOrderListRow[] = orders.map((o) => {
    const totalAmount = Number(o.totalAmount);
    const paid = Number(o.paidAmount);
    const returned = o.returns.reduce((s, r) => s + Number(r.totalAmount), 0);
    return {
      id: o.id,
      orderNo: o.orderNo,
      supplierName: o.supplier.name,
      status: o.status,
      sourceType: o.sourceType,
      totalAmount: money(totalAmount),
      paidAmount: money(paid),
      returned: money(returned),
      outstanding: money(totalAmount - paid - returned),
      starred: o.starred,
      operatorName: o.operator.displayName,
      operatorRole: o.operator.role,
      createdAt: day(o.createdAt),
      itemLines: o._count.items,
    };
  });

  return ok({
    page: Math.max(1, input.page ?? 1),
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    applied: {
      from: day(range.gte),
      to: day(range.lte),
      status: input.status ?? null,
      supplierId: input.supplierId ?? null,
      q: input.q ?? null,
      settle: input.settle ?? null,
      starredOnly: input.starred ?? false,
      onlyMine,
    },
    rows,
  });
}
