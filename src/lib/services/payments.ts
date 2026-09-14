import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { pinyinQuery } from "@/lib/pinyin";
import { dateRange } from "@/lib/reports";
import { PAYMENT_DIRECTION_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/payment-labels";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 财务流水（收客户的款 / 付厂家的款）查询服务。
 *
 * 口径照抄 src/app/(main)/payments/page.tsx，改动必须同步改页面：
 * - 默认只看"已登记"，作废的要显式选（`--status all|voided`）——财务口径上作废不算数
 * - 合计**不分收付**（两边的钱都要看），列表才按 direction 过滤
 * - 关联单据是**多态关联**：orderType(sale|purchase) + orderId，没有外键
 * - sales 角色无权限（与页面一致）
 */

const PAGE = 30;

const inputSchema = z.object({
  direction: z.enum(["receipt", "payment"]).optional(),
  /** all = 不管状态；默认只看已登记 */
  status: z.enum(["confirmed", "voided", "all"]).optional(),
  q: z.string().trim().max(50).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from 应为 YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to 应为 YYYY-MM-DD").optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export type ListPaymentsInput = z.input<typeof inputSchema>;

const money = (n: number) => n.toFixed(2);
const day = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function listPayments(
  actor: Actor,
  rawInput: ListPaymentsInput
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role === "sales") return fail("FORBIDDEN", "无权限查看财务流水（管理员/老板）");
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const input = parsed.data;

  const page = Math.max(1, input.page ?? 1);
  const pageSize = input.pageSize ?? PAGE;
  const range = dateRange(input.from, input.to);
  const status = input.status === "all" ? undefined : input.status === "voided" ? "voided" : "confirmed";

  // 关键词：收付款单号 / 备注 / 关联单据号 / 客户名（含拼音）/ 厂家名（含拼音）
  // 单据侧先各取 500 条 id（与页面同一上限），再并进付款表的 OR
  let qWhere = {};
  if (input.q) {
    const [sales, purchases] = await Promise.all([
      prisma.saleOrder.findMany({
        where: {
          OR: [
            { orderNo: { contains: input.q } },
            { customer: { name: { contains: input.q } } },
            { customer: { searchPinyin: { contains: pinyinQuery(input.q) } } },
          ],
        },
        select: { id: true },
        take: 500,
      }),
      prisma.purchaseOrder.findMany({
        where: {
          OR: [
            { orderNo: { contains: input.q } },
            { supplier: { name: { contains: input.q } } },
            { supplier: { searchPinyin: { contains: pinyinQuery(input.q) } } },
          ],
        },
        select: { id: true },
        take: 500,
      }),
    ]);
    qWhere = {
      OR: [
        { orderNo: { contains: input.q } },
        { remark: { contains: input.q } },
        { orderType: "sale" as const, orderId: { in: sales.map((s) => s.id) } },
        { orderType: "purchase" as const, orderId: { in: purchases.map((p) => p.id) } },
      ],
    };
  }

  const baseWhere = {
    ...(status ? { status: status as "confirmed" | "voided" } : {}),
    ...qWhere,
    createdAt: { gte: range.gte, lte: range.lte },
  };
  const listWhere = { ...baseWhere, ...(input.direction ? { direction: input.direction } : {}) };

  const [total, payments, sums] = await Promise.all([
    prisma.payment.count({ where: listWhere }),
    prisma.payment.findMany({
      where: listWhere,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { operator: { select: { displayName: true } } },
    }),
    prisma.payment.groupBy({ by: ["direction"], where: baseWhere, _sum: { amount: true } }),
  ]);

  // 对方（客户/厂家）与关联单据号：多态关联，按单据类型各查一次
  const saleIds = payments.filter((p) => p.orderType === "sale").map((p) => p.orderId);
  const purchaseIds = payments.filter((p) => p.orderType === "purchase").map((p) => p.orderId);
  const [sales, purchases] = await Promise.all([
    saleIds.length > 0
      ? prisma.saleOrder.findMany({
          where: { id: { in: saleIds } },
          select: { id: true, orderNo: true, customer: { select: { name: true } } },
        })
      : [],
    purchaseIds.length > 0
      ? prisma.purchaseOrder.findMany({
          where: { id: { in: purchaseIds } },
          select: { id: true, orderNo: true, supplier: { select: { name: true } } },
        })
      : [],
  ]);
  const saleMap = new Map(sales.map((s) => [s.id, s]));
  const purchaseMap = new Map(purchases.map((p) => [p.id, p]));

  const sumOf = (d: "receipt" | "payment") =>
    money(Number(sums.find((s) => s.direction === d)?._sum.amount ?? 0));

  return ok({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    /** 合计不分收付（与页面同一个口径）：两边的钱都要看 */
    sums: { receipt: sumOf("receipt"), payment: sumOf("payment") },
    applied: {
      from: day(range.gte),
      to: day(range.lte),
      direction: input.direction ?? null,
      status: status ?? "all",
      q: input.q ?? null,
      orderBy: "createdAt desc",
    },
    rows: payments.map((p) => {
      const rel = p.orderType === "sale" ? saleMap.get(p.orderId) : purchaseMap.get(p.orderId);
      const counterName =
        p.orderType === "sale"
          ? (saleMap.get(p.orderId) as { customer?: { name: string } } | undefined)?.customer?.name
          : (purchaseMap.get(p.orderId) as { supplier?: { name: string } } | undefined)?.supplier?.name;
      return {
        id: p.id,
        orderNo: p.orderNo,
        date: day(p.createdAt),
        direction: p.direction,
        directionLabel: PAYMENT_DIRECTION_LABELS[p.direction] ?? p.direction,
        amount: money(Number(p.amount)),
        method: p.method,
        methodLabel: PAYMENT_METHOD_LABELS[p.method] ?? p.method,
        status: p.status,
        statusLabel: PAYMENT_STATUS_LABELS[p.status] ?? p.status,
        /** 关联单据：多态关联，orderType 说明是售卖还是进货 */
        orderType: p.orderType,
        relatedOrderNo: rel && "orderNo" in rel ? rel.orderNo : null,
        counterName: counterName ?? null,
        operator: p.operator.displayName,
        remark: p.remark ?? "",
      };
    }),
  });
}
