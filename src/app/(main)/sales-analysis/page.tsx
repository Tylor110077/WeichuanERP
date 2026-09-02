import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { DateShortcuts } from "@/components/date-shortcuts";

export const metadata = { title: "销售分析 - 玮川进销存" };

/**
 * 销售分析：按日/周/自定义期间筛选，展示销售额/成本/总利润/利润率，
 * 商品维度（销量/销售额/成本/利润/利润率）与按日汇总列表。
 * 口径：非作废售卖单，成本按单据成本快照（与单据详情/报表中心一致）。
 */
export default async function SalesAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ quick?: string; from?: string; to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "sales") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限访问销售分析（管理员/老板）
      </div>
    );
  }

  const params = await searchParams;
  const quick = params.quick ?? "month";
  const { gte, lte, label } = resolveRange(quick, params.from, params.to);

  const orders = await prisma.saleOrder.findMany({
    where: { status: "confirmed", createdAt: { gte, lte } },
    include: {
      items: {
        include: { product: { select: { code: true, name: true, unit: { select: { name: true } } } } },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 5000,
  });

  // 汇总
  const totalSales = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
  let totalCost = 0;
  const byProduct = new Map<number, { code: string; name: string; unit: string; qty: number; sales: number; cost: number }>();
  const byDay = new Map<string, { count: number; sales: number; cost: number }>();
  for (const o of orders) {
    const dayKey = o.createdAt.toLocaleDateString("zh-CN");
    const day = byDay.get(dayKey) ?? { count: 0, sales: 0, cost: 0 };
    day.count += 1;
    day.sales += Number(o.totalAmount);
    for (const it of o.items) {
      totalCost += Number(it.costAmount);
      day.cost += Number(it.costAmount);
      const cur = byProduct.get(it.productId) ?? {
        code: it.product.code,
        name: it.product.name,
        unit: it.product.unit.name,
        qty: 0,
        sales: 0,
        cost: 0,
      };
      cur.qty += Number(it.quantity);
      cur.sales += Number(it.amount);
      cur.cost += Number(it.costAmount);
      byProduct.set(it.productId, cur);
    }
    byDay.set(dayKey, day);
  }
  const totalProfit = totalSales - totalCost;
  const totalMargin = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

  const productRows = [...byProduct.values()]
    .map((r) => ({ ...r, profit: r.sales - r.cost, margin: r.sales > 0 ? ((r.sales - r.cost) / r.sales) * 100 : 0 }))
    .sort((a, b) => b.profit - a.profit);

  const dayRows = [...byDay.entries()]
    .map(([date, v]) => ({ date, ...v, profit: v.sales - v.cost }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">销售分析</h1>

      <DateShortcuts basePath="/sales-analysis" />
      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <label htmlFor="from" className="block text-xs font-medium text-gray-600">自定义开始</label>
          <input id="from" type="date" name="from" defaultValue={params.from} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label htmlFor="to" className="block text-xs font-medium text-gray-600">自定义结束</label>
          <input id="to" type="date" name="to" defaultValue={params.to} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <button type="submit" className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200">
          查询
        </button>
        <span className="text-xs text-gray-500">{label} ・ {orders.length} 单</span>
      </form>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard label="销售额" value={`¥${totalSales.toFixed(2)}`} />
        <SummaryCard label="成本（成本快照）" value={`¥${totalCost.toFixed(2)}`} />
        <SummaryCard label="总利润" value={`¥${totalProfit.toFixed(2)}`} highlight={totalProfit >= 0} />
        <SummaryCard label="总体利润率" value={`${totalMargin.toFixed(2)}%`} highlight={totalMargin >= 0} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">编码</th>
              <th className="px-4 py-3 font-medium">商品</th>
              <th className="px-4 py-3 font-medium">单位</th>
              <th className="px-4 py-3 text-right font-medium">销量</th>
              <th className="px-4 py-3 text-right font-medium">销售额</th>
              <th className="px-4 py-3 text-right font-medium">成本</th>
              <th className="px-4 py-3 text-right font-medium">利润</th>
              <th className="px-4 py-3 text-right font-medium">利润率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {productRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  该期间无销售数据
                </td>
              </tr>
            )}
            {productRows.map((r) => (
              <tr key={r.code}>
                <td className="px-4 py-2.5 text-gray-600">{r.code}</td>
                <td className="px-4 py-2.5 text-gray-900">{r.name}</td>
                <td className="px-4 py-2.5 text-gray-600">{r.unit}</td>
                <td className="px-4 py-2.5 text-right text-gray-900">{r.qty.toFixed(3)}</td>
                <td className="px-4 py-2.5 text-right text-gray-900">¥{r.sales.toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right text-gray-600">¥{r.cost.toFixed(2)}</td>
                <td className={`px-4 py-2.5 text-right font-medium ${r.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                  ¥{r.profit.toFixed(2)}
                </td>
                <td className={`px-4 py-2.5 text-right ${r.margin >= 0 ? "text-green-700" : "text-red-600"}`}>
                  {r.margin.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr className="font-medium text-gray-900">
              <td colSpan={4} className="px-4 py-3 text-right">合计</td>
              <td className="px-4 py-3 text-right">¥{totalSales.toFixed(2)}</td>
              <td className="px-4 py-3 text-right">¥{totalCost.toFixed(2)}</td>
              <td className="px-4 py-3 text-right">¥{totalProfit.toFixed(2)}</td>
              <td className="px-4 py-3 text-right">{totalMargin.toFixed(2)}%</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">按日汇总</h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">日期</th>
                <th className="px-4 py-3 text-right font-medium">单数</th>
                <th className="px-4 py-3 text-right font-medium">销售额</th>
                <th className="px-4 py-3 text-right font-medium">成本</th>
                <th className="px-4 py-3 text-right font-medium">利润</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {dayRows.map((d) => (
                <tr key={d.date}>
                  <td className="px-4 py-2.5 text-gray-900">{d.date}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{d.count}</td>
                  <td className="px-4 py-2.5 text-right text-gray-900">¥{d.sales.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">¥{d.cost.toFixed(2)}</td>
                  <td className={`px-4 py-2.5 text-right font-medium ${d.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                    ¥{d.profit.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function resolveRange(quick: string, from?: string, to?: string) {
  const now = new Date();
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const gte = new Date(`${from}T00:00:00`);
    const lte = new Date(`${to}T23:59:59.999`);
    return { gte, lte, label: `${from} ~ ${to}` };
  }
  if (quick === "today") {
    const gte = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lte = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { gte, lte, label: "今天" };
  }
  if (quick === "week") {
    const day = now.getDay() || 7; // 周一起
    const gte = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day - 1));
    const lte = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { gte, lte, label: "本周（周一起）" };
  }
  if (quick === "all") {
    return { gte: new Date(2000, 0, 1), lte: new Date(2100, 11, 31, 23, 59, 59, 999), label: "全部记录" };
  }
  // 默认本月
  const gte = new Date(now.getFullYear(), now.getMonth(), 1);
  const lte = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { gte, lte, label: "本月" };
}

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`mt-2 text-xl font-semibold ${highlight === undefined ? "text-gray-900" : highlight ? "text-green-700" : "text-red-600"}`}>
        {value}
      </div>
    </div>
  );
}
