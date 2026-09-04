import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { CuPriceChart } from "@/components/cu-price-chart";

/**
 * 工作台（文档 4#2）：今日销售额、待收货进货单、负库存预警、库存预警、应收应付概览。
 * 数据均为实时统计；成本/毛利项不在此页（矩阵：业务员不可见成本毛利）。
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // 铜价行情：最近 14 天 + 最近一天的当日时点（供趋势图）
  const cuRows = await prisma.cuPrice.findMany({
    orderBy: { priceDate: "desc" },
    take: 14,
  });
  const cu14 = [...cuRows].reverse(); // 时间升序
  const latestCu = cuRows[0] ?? null;

  const [todaySales, pendingPurchases, warningCount] = await Promise.all([
    prisma.saleOrder.aggregate({
      where: { status: "confirmed", createdAt: { gte: todayStart } },
      _sum: { totalAmount: true },
    }),
    prisma.purchaseOrder.findMany({
      where: { status: "pending" },
      select: { totalAmount: true },
    }),
    prisma.product.count({
      where: { status: 1, minStock: { gt: 0 }, stockQty: { lt: prisma.product.fields.minStock } },
    }),
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

  const receivableTotal = Number(receivableRows[0]?.total ?? 0);
  const payableTotal = Number(payableRows[0]?.total ?? 0);
  const pendingTotal = pendingPurchases.reduce((s, o) => s + Number(o.totalAmount), 0);

  const statCards = [
    { label: "今日销售额", value: `¥${Number(todaySales._sum.totalAmount ?? 0).toFixed(2)}`, note: "今日已开售卖单（未作废）" },
    { label: "待收货进货单", value: `${pendingPurchases.length} 张`, note: `合计 ¥${pendingTotal.toFixed(2)}（手动进货单）` },
    { label: "库存预警", value: `${warningCount} 个`, note: "低于预警线的启用商品" },
    { label: "应收余额", value: `¥${receivableTotal.toFixed(2)}`, note: "客户未收合计（含已开单未收）" },
    { label: "应付余额", value: `¥${payableTotal.toFixed(2)}`, note: "供应商未付合计" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">
        工作台
        <span className="ml-3 text-sm font-normal text-gray-500">
          你好，{user?.displayName}
        </span>
      </h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-gray-200 bg-white p-5"
          >
            <div className="text-sm text-gray-500">{card.label}</div>
            <div className="mt-2 text-2xl font-semibold text-gray-900">
              {card.value}
            </div>
            <div className="mt-1 text-xs text-gray-400">{card.note}</div>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">近 14 天铜价走势</h2>
            <span className="text-xs text-gray-400">元/吨</span>
          </div>
          <CuPriceChart
            points={cu14.map((r) => ({
              label: r.priceDate.toISOString().slice(5, 10),
              price: Number(r.price),
            }))}
          />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">
              当日铜价趋势
              {latestCu ? `（${latestCu.priceDate.toISOString().slice(0, 10)} ¥${Number(latestCu.price).toFixed(2)}）` : ""}
            </h2>
            <span className="text-xs text-gray-400">时点价格</span>
          </div>
          <CuPriceChart
            points={
              latestCu && Array.isArray(latestCu.intraday)
                ? (latestCu.intraday as { time: string; price: number }[]).map((p) => ({ label: p.time, price: p.price }))
                : []
            }
            label="当日铜价（元/吨）"
          />
        </div>
      </div>
    </div>
  );
}
