import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

/**
 * 工作台（文档 4#2）：只保留日常高频信息 —— 今日销售额、今日利润、应收总额、应付总额，
 * 以及「销售开单 / 进货开单」两个快捷入口。
 * 权限：利润涉及成本，仅管理员/老板可见；开单入口仅管理员/业务员可见（老板/财务不可开单）。
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  const canSeeProfit = user?.role === "admin" || user?.role === "boss";
  const canCreateOrder = user?.role === "admin" || user?.role === "sales";

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

  const cards: { label: string; value: string; note: string; tone?: "profit" | "loss" }[] = [
    {
      label: "今日销售额",
      value: `¥${todaySalesAmount.toFixed(2)}`,
      note: "今日已开售卖单（未作废）",
    },
    ...(canSeeProfit
      ? [
          {
            label: "今日利润",
            value: `¥${todayProfit.toFixed(2)}`,
            note: todayMargin == null ? "今日暂无销售" : `毛利率 ${todayMargin.toFixed(2)}%`,
            tone: (todayProfit >= 0 ? "profit" : "loss") as "profit" | "loss",
          },
        ]
      : []),
    {
      label: "应收总额",
      value: `¥${receivableTotal.toFixed(2)}`,
      note: "客户未收合计（含已开单未收）",
    },
    {
      label: "应付总额",
      value: `¥${payableTotal.toFixed(2)}`,
      note: "厂家未付合计",
    },
  ];

  const quickActions = [
    {
      href: "/sale-orders/new",
      title: "销售开单",
      desc: "给客户开售卖单，缺货可自动向厂家补货",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          <path d="M6 2h9l5 5v15H6z" strokeLinejoin="round" />
          <path d="M15 2v5h5" strokeLinejoin="round" />
          <path d="M9 13h6M9 17h4" strokeLinecap="round" />
        </svg>
      ),
      theme: "blue" as const,
    },
    {
      href: "/purchase-orders/new",
      title: "进货开单",
      desc: "向厂家开进货单，入库后自动计入库存成本",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          <path d="M3 7l9-4 9 4v10l-9 4-9-4z" strokeLinejoin="round" />
          <path d="M3 7l9 4 9-4M12 11v10" strokeLinejoin="round" />
        </svg>
      ),
      theme: "green" as const,
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
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

      {/* 数字概览 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-gray-200 bg-white p-5 transition hover:border-gray-300 hover:shadow-sm"
          >
            <div className="text-sm text-gray-500">{card.label}</div>
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
          </div>
        ))}
      </div>

      {/* 快捷开单 */}
      {canCreateOrder && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">快捷开单</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {quickActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 transition hover:border-blue-300 hover:shadow-sm"
              >
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
                    action.theme === "blue"
                      ? "bg-blue-50 text-blue-600 group-hover:bg-blue-100"
                      : "bg-green-50 text-green-600 group-hover:bg-green-100"
                  }`}
                >
                  {action.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-medium text-gray-900 group-hover:text-blue-700">
                    {action.title}
                  </span>
                  <span className="block text-xs text-gray-500">{action.desc}</span>
                </span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-4 w-4 shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-blue-500"
                >
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
