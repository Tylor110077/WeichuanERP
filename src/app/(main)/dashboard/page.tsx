import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { ShortcutBoard } from "./shortcut-board";
import {
  catalogForRole,
  defaultShortcutIds,
  readShortcutIds,
  resolveShortcuts,
} from "@/lib/shortcuts";

/**
 * 工作台（文档 4#2）：日常高频数字 —— 今日销售额、今日利润、应收总额、应付总额，
 * 外加一块由用户自己编排的「快捷入口」：存 User.shortcuts，没设置过就按角色给一套默认。
 * 权限：利润涉及成本，仅管理员/老板可见；开单类入口只有管理员/业务员能放（见 lib/shortcuts.ts）。
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  const canSeeProfit = user?.role === "admin" || user?.role === "boss";

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // 今日销售额 / 今日成本（成本快照，仅授权角色才查）
  const [todaySales, todayCost] = await Promise.all([
    prisma.saleOrder.aggregate({
      where: { status: "confirmed", createdAt: { gte: todayStart } },
      _sum: { totalAmount: true },
    }),
    canSeeProfit
      ? prisma.saleOrderItem.aggregate({
          where: { saleOrder: { status: "confirmed", createdAt: { gte: todayStart } } },
          _sum: { costAmount: true },
        })
      : Promise.resolve({ _sum: { costAmount: null } }),
  ]);

  // 应收/应付合计（与应收应付页同口径：单额 − 已收付 − 未作废退货冲减）
  const [receivableRows, payableRows] = await Promise.all([
    prisma.$queryRaw<{ total: number | null }[]>`
      SELECT COALESCE(SUM(so.total_amount - so.received_amount - COALESCE(sr.total, 0)), 0) AS total
      FROM sale_orders so
      LEFT JOIN (
        SELECT sale_order_id, SUM(total_amount) AS total
        FROM sale_returns WHERE status = 'confirmed' GROUP BY sale_order_id
      ) sr ON sr.sale_order_id = so.id
      WHERE so.status = 'confirmed'`,
    prisma.$queryRaw<{ total: number | null }[]>`
      SELECT COALESCE(SUM(po.total_amount - po.paid_amount - COALESCE(pr.total, 0)), 0) AS total
      FROM purchase_orders po
      LEFT JOIN (
        SELECT purchase_order_id, SUM(total_amount) AS total
        FROM purchase_returns WHERE status = 'confirmed' GROUP BY purchase_order_id
      ) pr ON pr.purchase_order_id = po.id
      WHERE po.status IN ('pending', 'received')`,
  ]);

  const todaySalesAmount = Number(todaySales._sum.totalAmount ?? 0);
  const todayCostAmount = Number(todayCost._sum.costAmount ?? 0);
  const todayProfit = todaySalesAmount - todayCostAmount;
  const todayMargin = todaySalesAmount > 0 ? (todayProfit / todaySalesAmount) * 100 : null;
  const receivableTotal = Number(receivableRows[0]?.total ?? 0);
  const payableTotal = Number(payableRows[0]?.total ?? 0);

  const canViewFinance = user?.role === "admin" || user?.role === "boss";

  // 快捷入口：库里存 id 数组。null = 从没自定义过（用角色默认）；[] = 用户主动清空了（就显示空）
  const role = user?.role ?? "sales";
  const storedIds = readShortcutIds(user?.shortcuts);
  const shortcuts = resolveShortcuts(
    storedIds ?? defaultShortcutIds(role),
    role
  );
  const catalog = catalogForRole(role);

  const cards: {
    label: string;
    value: string;
    note: string;
    href?: string;
    tone?: "profit" | "loss";
  }[] = [
    {
      label: "今日销售额",
      value: `¥${todaySalesAmount.toFixed(2)}`,
      note: "今日已开售卖单（未作废）",
      href: "/sale-orders",
    },
    ...(canSeeProfit
      ? [
          {
            label: "今日利润",
            value: `¥${todayProfit.toFixed(2)}`,
            note: todayMargin == null ? "今日暂无销售" : `毛利率 ${todayMargin.toFixed(2)}%`,
            href: "/sales-analysis",
            tone: (todayProfit >= 0 ? "profit" : "loss") as "profit" | "loss",
          },
        ]
      : []),
    {
      label: "应收总额",
      value: `¥${receivableTotal.toFixed(2)}`,
      note: "全部时间的客户未收合计",
      href: canViewFinance ? "/receivables-payables?view=receivable" : undefined,
    },
    {
      label: "应付总额",
      value: `¥${payableTotal.toFixed(2)}`,
      note: "全部时间的厂家未付合计",
      href: canViewFinance ? "/receivables-payables?view=payable" : undefined,
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">
          工作台
          <span className="ml-3 text-sm font-normal text-gray-500">你好，{user?.displayName}</span>
        </h1>
        <span className="text-sm text-gray-400">
          {new Date().toLocaleDateString("zh-CN", {
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "long",
          })}
        </span>
      </div>

      {/* 数字概览（可点击的卡片直达对应页面） */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((card) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm text-gray-500">{card.label}</span>
                {card.href && (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-4 w-4 shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-blue-500"
                  >
                    <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <div
                className={`mt-2 text-2xl font-semibold tabular-nums ${
                  card.tone === "profit"
                    ? "text-green-700"
                    : card.tone === "loss"
                      ? "text-red-600"
                      : "text-gray-900"
                }`}
              >
                {card.value}
              </div>
              <div className="mt-1.5 text-xs text-gray-400">{card.note}</div>
            </>
          );

          const base =
            "rounded-xl border border-gray-200 bg-white p-5 transition";

          return card.href ? (
            <Link
              key={card.label}
              href={card.href}
              className={`group ${base} hover:border-blue-300 hover:shadow-sm`}
            >
              {body}
            </Link>
          ) : (
            <div key={card.label} className={base}>
              {body}
            </div>
          );
        })}
      </div>

      <ShortcutBoard shortcuts={shortcuts} catalog={catalog} />
    </div>
  );
}
