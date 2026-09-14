import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { dateRange } from "@/lib/reports";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 应收 / 应付查询服务（CLI 与网页共用）。
 *
 * 口径裁决见 docs/agent-cli-plan.md §13.8 #1，这里同时给**两个数**，别混用：
 * - `outstandingTotalAllTime`：当前未结清存量（全部时间）——工作台「应收/应付总额」用的就是它
 * - `outstandingTotalInRange`：区间内未结清合计——应收应付页合计卡用的是它
 * 两者都不含"负的未结清"：超收/超退形成的负值是预收/预付，不是应收（逐单 GREATEST(...,0)）。
 *
 * 与页面相比修掉一处：页面是 `take: 200` 之后在内存里筛未结清再分页，
 * 于是"最近 200 张"里已结清的多时，能看到的未结清单会远少于 200 甚至为空。
 * 这里把未结清谓词下推成 SQL，先筛后分页。
 *
 * 权限与页面一致：sales 角色看不到应收应付。
 */

const PAGE = 20;

const inputSchema = z.object({
  direction: z.enum(["receivable", "payable"]).default("receivable"),
  /** 只看某个客户/厂家 */
  counterId: z.coerce.number().int().positive().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from 应为 YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to 应为 YYYY-MM-DD").optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export type ListOutstandingInput = z.input<typeof inputSchema>;

const money = (n: number) => n.toFixed(2);
const day = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function listOutstanding(
  actor: Actor,
  rawInput: ListOutstandingInput
): Promise<CliResult<Record<string, unknown>>> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const input = parsed.data;
  if (actor.role === "sales") return fail("FORBIDDEN", "无权限访问应收应付（管理员/老板）");

  const isR = input.direction === "receivable";
  const pageSize = input.pageSize ?? PAGE;
  const page = Math.max(1, input.page ?? 1);
  const range = dateRange(input.from, input.to);

  // ── 未结清单据 id（先筛后分页；ORDER BY 与页面一致，保证切片顺序相同）
  const unsettledIds = isR
    ? (
        await prisma.$queryRaw<{ id: number }[]>`
          SELECT so.id FROM sale_orders so
          LEFT JOIN (
            SELECT sale_order_id, SUM(total_amount) AS t FROM sale_returns WHERE status='confirmed' GROUP BY sale_order_id
          ) sr ON sr.sale_order_id = so.id
          WHERE so.status = 'confirmed'
            AND so.created_at >= ${range.gte} AND so.created_at <= ${range.lte}
            ${input.counterId ? Prisma.sql`AND so.customer_id = ${input.counterId}` : Prisma.sql``}
            AND (so.total_amount - so.received_amount - COALESCE(sr.t, 0)) > 0
          ORDER BY so.created_at DESC`
      ).map((r) => r.id)
    : (
        await prisma.$queryRaw<{ id: number }[]>`
          SELECT po.id FROM purchase_orders po
          LEFT JOIN (
            SELECT purchase_order_id, SUM(total_amount) AS t FROM purchase_returns WHERE status='confirmed' GROUP BY purchase_order_id
          ) pr ON pr.purchase_order_id = po.id
          WHERE po.status IN ('pending', 'received')
            AND po.created_at >= ${range.gte} AND po.created_at <= ${range.lte}
            ${input.counterId ? Prisma.sql`AND po.supplier_id = ${input.counterId}` : Prisma.sql``}
            AND (po.total_amount - po.paid_amount - COALESCE(pr.t, 0)) > 0
          ORDER BY po.created_at DESC`
      ).map((r) => r.id);

  const total = unsettledIds.length;
  const pageIds = unsettledIds.slice((page - 1) * pageSize, page * pageSize);

  // ── 当前页单据（含明细：展开时要看商品，与页面一致）
  const orderRows = isR
    ? await prisma.saleOrder.findMany({
        where: { id: { in: pageIds } },
        orderBy: { createdAt: "desc" },
        include: {
          customer: { select: { name: true } },
          returns: { where: { status: "confirmed" }, select: { totalAmount: true } },
          items: {
            orderBy: { id: "asc" },
            include: {
              product: { select: { code: true, name: true, manufacturer: true } },
              unit: { select: { name: true } },
            },
          },
        },
      })
    : await prisma.purchaseOrder.findMany({
        where: { id: { in: pageIds } },
        orderBy: { createdAt: "desc" },
        include: {
          supplier: { select: { name: true } },
          returns: { where: { status: "confirmed" }, select: { totalAmount: true } },
          items: {
            orderBy: { id: "asc" },
            include: {
              product: { select: { code: true, name: true, manufacturer: true } },
              unit: { select: { name: true } },
            },
          },
        },
      });

  // ── 按对方汇总 + 两个口径的合计
  // 注意：必须用 SQL 聚合——拿分页后的结果在内存里求和会静默少算，
  // 而且会与工作台出现两个不同的数（这正是 §13.8 #1 要分开命名的原因）。
  const byCounter = isR
    ? await prisma.$queryRaw<{ counterId: number; name: string; total: string; unsettled: bigint }[]>`
        SELECT so.customer_id AS counterId, c.name AS name,
               COALESCE(SUM(GREATEST(so.total_amount - so.received_amount - COALESCE(sr.total, 0), 0)), 0) AS total,
               COALESCE(SUM(CASE WHEN so.total_amount - so.received_amount - COALESCE(sr.total, 0) > 0 THEN 1 ELSE 0 END), 0) AS unsettled
        FROM sale_orders so
        JOIN customers c ON c.id = so.customer_id
        LEFT JOIN (
          SELECT sale_order_id, SUM(total_amount) AS total FROM sale_returns WHERE status='confirmed' GROUP BY sale_order_id
        ) sr ON sr.sale_order_id = so.id
        WHERE so.status='confirmed' AND so.created_at >= ${range.gte} AND so.created_at <= ${range.lte}
          ${input.counterId ? Prisma.sql`AND so.customer_id = ${input.counterId}` : Prisma.sql``}
        GROUP BY so.customer_id, c.name
        ORDER BY total DESC`
    : await prisma.$queryRaw<{ counterId: number; name: string; total: string; unsettled: bigint }[]>`
        SELECT po.supplier_id AS counterId, s.name AS name,
               COALESCE(SUM(GREATEST(po.total_amount - po.paid_amount - COALESCE(pr.total, 0), 0)), 0) AS total,
               COALESCE(SUM(CASE WHEN po.total_amount - po.paid_amount - COALESCE(pr.total, 0) > 0 THEN 1 ELSE 0 END), 0) AS unsettled
        FROM purchase_orders po
        JOIN suppliers s ON s.id = po.supplier_id
        LEFT JOIN (
          SELECT purchase_order_id, SUM(total_amount) AS total FROM purchase_returns WHERE status='confirmed' GROUP BY purchase_order_id
        ) pr ON pr.purchase_order_id = po.id
        WHERE po.status IN ('pending','received') AND po.created_at >= ${range.gte} AND po.created_at <= ${range.lte}
          ${input.counterId ? Prisma.sql`AND po.supplier_id = ${input.counterId}` : Prisma.sql``}
        GROUP BY po.supplier_id, s.name
        ORDER BY total DESC`;

  const allTime = isR
    ? await prisma.$queryRaw<{ total: string }[]>`
        SELECT COALESCE(SUM(GREATEST(so.total_amount - so.received_amount - COALESCE(sr.total, 0), 0)), 0) AS total
        FROM sale_orders so
        LEFT JOIN (
          SELECT sale_order_id, SUM(total_amount) AS total FROM sale_returns WHERE status='confirmed' GROUP BY sale_order_id
        ) sr ON sr.sale_order_id = so.id
        WHERE so.status='confirmed'
          ${input.counterId ? Prisma.sql`AND so.customer_id = ${input.counterId}` : Prisma.sql``}`
    : await prisma.$queryRaw<{ total: string }[]>`
        SELECT COALESCE(SUM(GREATEST(po.total_amount - po.paid_amount - COALESCE(pr.total, 0), 0)), 0) AS total
        FROM purchase_orders po
        LEFT JOIN (
          SELECT purchase_order_id, SUM(total_amount) AS total FROM purchase_returns WHERE status='confirmed' GROUP BY purchase_order_id
        ) pr ON pr.purchase_order_id = po.id
        WHERE po.status IN ('pending','received')
          ${input.counterId ? Prisma.sql`AND po.supplier_id = ${input.counterId}` : Prisma.sql``}`;

  const inRangeTotal = byCounter.reduce((s, r) => s + Number(r.total), 0);

  return ok({
    direction: input.direction,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    /** 区间内未结清合计（与应收应付页合计卡同一个数） */
    outstandingTotalInRange: money(inRangeTotal),
    /** 当前未结清存量（全部时间）。未指定 counterId 时等于工作台那个数；指定了就只算该对方 */
    outstandingTotalAllTime: money(Number(allTime[0]?.total ?? 0)),
    /** 区间内还有欠款未结清的单据张数 */
    unsettledCountInRange: byCounter.reduce((s, r) => s + Number(r.unsettled), 0),
    applied: {
      from: day(range.gte),
      to: day(range.lte),
      counterId: input.counterId ?? null,
      page: page,
      orderBy: "createdAt desc",
    },
    byCounter: byCounter.map((r) => ({
      counterId: Number(r.counterId),
      name: r.name,
      outstanding: money(Number(r.total)),
      unsettledOrders: Number(r.unsettled),
    })),
    rows: orderRows.map((o) => {
      const returned = o.returns.reduce((s, r) => s + Number(r.totalAmount), 0);
      const totalAmount = Number(o.totalAmount);
      const paid = isR
        ? Number((o as { receivedAmount: unknown }).receivedAmount)
        : Number((o as { paidAmount: unknown }).paidAmount);
      const counterName = isR
        ? (o as { customer: { name: string } }).customer.name
        : (o as { supplier: { name: string } }).supplier.name;
      return {
        id: o.id,
        orderNo: o.orderNo,
        date: day(o.createdAt),
        counterName,
        totalAmount: money(totalAmount),
        paid: money(paid),
        returned: money(returned),
        outstanding: money(Math.max(0, totalAmount - paid - returned)),
        items: o.items.map((it) => ({
          code: it.product.code,
          name: it.product.name,
          manufacturer: it.product.manufacturer,
          unit: it.unit.name,
          quantity: Number(it.quantity).toFixed(3),
          unitPrice: money(Number(it.unitPrice)),
          amount: money(Number(it.amount)),
        })),
      };
    }),
  });
}
