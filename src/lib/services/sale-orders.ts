import { Prisma } from "@prisma/client";
import { z } from "zod";
import { zBoolean } from "@/lib/form-bool";
import { prisma } from "@/lib/prisma";
import { pinyinQuery } from "@/lib/pinyin";
import { dateRange } from "@/lib/reports";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 售卖单的只读查询服务（CLI 与网页共用一套口径）。
 *
 * 为什么要抽出来：CLI 的验收标准是"同一条件下，CLI 的数字与页面一致"。
 * 只要两边各写一份查询，这件事就迟早会漂——页面里已经有 7 份 dateRange 副本、
 * 4 处应收应付 SQL，都是这么来的。
 *
 * 口径全部照抄 src/app/(main)/sale-orders/page.tsx，**改动这里必须同步改页面**：
 * - 默认时间范围：本月 1 日 ~ 今天（dateRange 来自 lib/reports.ts，与页面一致）
 * - 未结清 = 单额 − 已收 − 未作废退货冲减 > 0（页面那段原生 SQL 原样搬过来）
 * - sales 角色只看得见自己开的单（**行级可见范围，不能漏**）
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 200;

const inputSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  status: z.enum(["confirmed", "voided"]).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(50).optional(),
  settle: z.enum(["settled", "unsettled"]).optional(),
  starred: zBoolean().optional(),
  /** 来源筛选：agent = 只看 Agent 代做的（溯源用） */
  origin: z.enum(["agent", "human"]).optional(),
  /** 审核状态筛选 */
  review: z.enum(["pending_review", "approved", "rejected", "not_required"]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from 应为 YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to 应为 YYYY-MM-DD").optional(),
});

export type ListSaleOrdersInput = z.input<typeof inputSchema>;

/** 金额保留 2 位、数量 3 位，一律以字符串返回（计划 §6.3：不把 Decimal 交给浮点） */
const money = (n: number) => n.toFixed(2);
const qty = (n: number) => n.toFixed(3);
/** 本地时区的 YYYY-MM-DD（与页面的"本地时区"口径一致） */
const day = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface SaleOrderListRow {
  id: number;
  orderNo: string;
  customerName: string;
  status: string;
  totalAmount: string;
  receivedAmount: string;
  returned: string;
  outstanding: string;
  starred: boolean;
  operatorName: string;
  operatorRole: string;
  createdAt: string;
  itemLines: number;
  /** human = 人做的；agent = Agent 代做（Agent 必须诚实标注自己） */
  actorKind: "human" | "agent";
  /** not_required（人建单）/ pending_review / approved / rejected */
  reviewStatus: string;
}

export interface SaleOrderListResult {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** 本次**实际生效**的条件（含默认期间与行级可见范围），便于对数与排查"为什么数字不一样" */
  applied: Record<string, unknown>;
  rows: SaleOrderListRow[];
}

export async function listSaleOrders(
  actor: Actor,
  rawInput: ListSaleOrdersInput
): Promise<CliResult<SaleOrderListResult>> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const input = parsed.data;

  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  const range = dateRange(input.from, input.to);
  /** sales 只看得见自己开的单——与页面同一条行级规则，漏了就是越权读取 */
  const onlyMine = actor.role === "sales";

  // 款项结清筛选：与页面同一段 SQL（先取 id 集合，再并进主查询）
  let settleIds: number[] | null = null;
  if (input.settle) {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT so.id FROM sale_orders so
      LEFT JOIN (
        SELECT sale_order_id, SUM(total_amount) AS t
        FROM sale_returns WHERE status = 'confirmed' GROUP BY sale_order_id
      ) sr ON sr.sale_order_id = so.id
      WHERE so.status = 'confirmed'
        AND (so.total_amount - so.received_amount - COALESCE(sr.t, 0)) ${input.settle === "settled" ? Prisma.sql`<= 0` : Prisma.sql`> 0`}`;
    settleIds = rows.map((r) => r.id);
  }

  const where = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.customerId ? { customerId: input.customerId } : {}),
    ...(input.q
      ? {
          OR: [
            { orderNo: { contains: input.q } },
            { customer: { name: { contains: input.q } } },
            { customer: { searchPinyin: { contains: pinyinQuery(input.q) } } },
          ],
        }
      : {}),
    ...(settleIds ? { id: { in: settleIds } } : {}),
    ...(input.starred ? { starred: true } : {}),
    ...(input.origin ? { actorKind: input.origin } : {}),
    ...(input.review ? { reviewStatus: input.review } : {}),
    createdAt: { gte: range.gte, lte: range.lte },
    ...(onlyMine ? { operatorId: actor.userId } : {}),
  };

  const [total, orders] = await Promise.all([
    prisma.saleOrder.count({ where }),
    prisma.saleOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (Math.max(1, input.page ?? 1) - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { name: true } },
        operator: { select: { displayName: true, role: true } },
        returns: { where: { status: "confirmed" }, select: { totalAmount: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);

  const rows: SaleOrderListRow[] = orders.map((o) => {
    const totalAmount = Number(o.totalAmount);
    const received = Number(o.receivedAmount);
    const returned = o.returns.reduce((s, r) => s + Number(r.totalAmount), 0);
    return {
      id: o.id,
      orderNo: o.orderNo,
      customerName: o.customer.name,
      status: o.status,
      totalAmount: money(totalAmount),
      receivedAmount: money(received),
      returned: money(returned),
      outstanding: money(totalAmount - received - returned),
      starred: o.starred,
      operatorName: o.operator.displayName,
      operatorRole: o.operator.role,
      createdAt: day(o.createdAt),
      itemLines: o._count.items,
      /** 来源与审核状态（与列表页角标同口径） */
      actorKind: o.actorKind,
      reviewStatus: o.reviewStatus,
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
      customerId: input.customerId ?? null,
      q: input.q ?? null,
      settle: input.settle ?? null,
      starredOnly: input.starred ?? false,
      onlyMine,
      origin: input.origin ?? null,
      review: input.review ?? null,
    },
    rows,
  });
}

/** 单行数量口径（导出给测试与将来的命令复用） */
export { money as formatMoney, qty as formatQty };
