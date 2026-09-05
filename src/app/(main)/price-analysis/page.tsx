import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { DateShortcuts } from "@/components/date-shortcuts";
import { buildPriceAnalysis } from "@/lib/price-analysis";
import { PriceChart } from "./price-chart";
import { ProductPicker } from "./product-picker";

export const metadata = { title: "价格分析 - 玮川进销存" };

/**
 * 商品价格分析：同一商品对不同客户、不同时间的售价与成本（开单成本快照）变化。
 * 图表：售价散点按客户着色 + 成本折线 + 参考售价虚线；下附按客户汇总与交易明细。
 * 仅管理员/老板可见（含成本、毛利）。
 */
export default async function PriceAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; productId?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "sales") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限访问价格分析（管理员/老板）
      </div>
    );
  }

  const params = await searchParams;
  const { gte, lte, label } = resolveRange(params.from, params.to);

  const products = await prisma.product.findMany({
    where: { status: 1 },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  const productId = params.productId ? Number(params.productId) : 0;
  const analysis = products.some((p) => p.id === productId)
    ? await buildPriceAnalysis(productId, gte, lte)
    : null;

  const t = analysis?.totals;
  const detailRows = analysis ? [...analysis.points].reverse().slice(0, 500) : [];
  const detailCapped = analysis ? analysis.points.length > 500 : false;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">价格分析</h1>

      {/* 筛选：商品（即选即筛） + 日期（GET 表单） */}
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-700">商品</span>
          <ProductPicker products={products} current={productId} from={params.from} to={params.to} />
          <form action="/price-analysis" className="ml-auto flex flex-wrap items-end gap-3">
            {productId ? <input type="hidden" name="productId" value={productId} /> : null}
            <div>
              <label htmlFor="from" className="block text-xs font-medium text-gray-600">开始</label>
              <input id="from" type="date" name="from" defaultValue={params.from} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label htmlFor="to" className="block text-xs font-medium text-gray-600">结束</label>
              <input id="to" type="date" name="to" defaultValue={params.to} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <button type="submit" className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200">
              按日期查询
            </button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DateShortcuts basePath="/price-analysis" extraQuery={{ productId: productId ? String(productId) : "" }} />
          <span className="text-xs text-gray-500">{label}</span>
        </div>
      </div>

      {!analysis && (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-400">
          请在上方选择要分析的商品，查看其售价与成本随客户、时间的变化
        </div>
      )}

      {analysis && t && (
        <>
          {/* 概览 */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <SummaryCard label={`期间销量（${analysis.product.unit}）`} value={t.qty.toFixed(3)} />
            <SummaryCard label="销售额" value={`¥${t.amount.toFixed(2)}`} />
            <SummaryCard label="平均售价" value={`¥${t.avgPrice.toFixed(2)}`} sub={t.maxPrice > 0 ? `¥${t.minPrice.toFixed(2)} ~ ¥${t.maxPrice.toFixed(2)}` : undefined} />
            <SummaryCard label="平均成本单价" value={`¥${t.avgCost.toFixed(2)}`} />
            <SummaryCard label="毛利" value={`¥${t.profit.toFixed(2)}`} highlight={t.profit >= 0} />
            <SummaryCard label="平均毛利率" value={`${t.margin.toFixed(2)}%`} highlight={t.margin >= 0} />
          </div>

          {/* 图表 */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900">
                {analysis.product.name}
                <span className="ml-2 text-xs font-normal text-gray-400">
                  灰点＝每笔实际售价 ・ 橙线＝当日成本（区间＝当日最高/最低成本波动） ・{" "}
                  {analysis.byDay.length} 天 / {analysis.points.length} 笔销售
                </span>
              </h2>
              <span className="text-xs text-gray-400">{label}</span>
            </div>
            {analysis.points.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-gray-400">
                该期间内此商品无销售记录
              </div>
            ) : (
              <PriceChart
                points={analysis.points}
                byDay={analysis.byDay}
                refSalePrice={analysis.product.refSalePrice}
              />
            )}
          </div>

          {/* 每日售价统计：当日最高/最低售价分别是哪一单、利润率多少 */}
          {analysis.byDay.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-gray-900">每日售价统计</h2>
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs text-gray-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">日期</th>
                      <th className="px-4 py-3 text-right font-medium">单数</th>
                      <th className="px-4 py-3 text-right font-medium">当日成本区间</th>
                      <th className="px-4 py-3 font-medium">售价最高单</th>
                      <th className="px-4 py-3 text-right font-medium">最高售价</th>
                      <th className="px-4 py-3 text-right font-medium">最高单毛利率</th>
                      <th className="px-4 py-3 font-medium">售价最低单</th>
                      <th className="px-4 py-3 text-right font-medium">最低售价</th>
                      <th className="px-4 py-3 text-right font-medium">最低单毛利率</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[...analysis.byDay].reverse().map((d) => {
                      const one = d.highest === d.lowest;
                      return (
                        <tr key={d.dayTs}>
                          <td className="px-4 py-2.5 text-gray-900">{d.date}</td>
                          <td className="px-4 py-2.5 text-right text-gray-600">{d.saleCount}</td>
                          <td className="px-4 py-2.5 text-right text-[#ea580c]">
                            {d.minCost === d.maxCost
                              ? `¥${d.minCost.toFixed(2)}`
                              : `¥${d.minCost.toFixed(2)} ~ ¥${d.maxCost.toFixed(2)}`}
                          </td>
                          <td className="px-4 py-2.5 text-gray-900">
                            {d.highest.customer}
                            <span className="ml-1.5 text-xs text-gray-500">{d.highest.orderNo}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium text-gray-900">¥{d.highest.unitPrice.toFixed(2)}</td>
                          <td className={`px-4 py-2.5 text-right ${d.highest.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                            {d.highest.margin.toFixed(2)}%
                          </td>
                          <td className="px-4 py-2.5 text-gray-900">
                            {one ? "同上（仅一单）" : d.lowest.customer}
                            {!one && <span className="ml-1.5 text-xs text-gray-500">{d.lowest.orderNo}</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium text-gray-900">¥{d.lowest.unitPrice.toFixed(2)}</td>
                          <td className={`px-4 py-2.5 text-right ${d.lowest.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                            {d.lowest.margin.toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 按客户汇总 */}
          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-900">按客户汇总</h2>
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">客户</th>
                    <th className="px-4 py-3 text-right font-medium">单数</th>
                    <th className="px-4 py-3 text-right font-medium">销量</th>
                    <th className="px-4 py-3 text-right font-medium">平均售价</th>
                    <th className="px-4 py-3 text-right font-medium">最低售价</th>
                    <th className="px-4 py-3 text-right font-medium">最高售价</th>
                    <th className="px-4 py-3 text-right font-medium">平均成本</th>
                    <th className="px-4 py-3 text-right font-medium">毛利</th>
                    <th className="px-4 py-3 text-right font-medium">毛利率</th>
                    <th className="px-4 py-3 text-right font-medium">最近购买</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {analysis.byCustomer.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                        该期间无销售数据
                      </td>
                    </tr>
                  )}
                  {analysis.byCustomer.map((r) => {
                    return (
                      <tr key={r.customer}>
                        <td className="px-4 py-2.5 text-gray-900">{r.customer}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{r.orderCount}</td>
                        <td className="px-4 py-2.5 text-right text-gray-900">{r.qty.toFixed(3)}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-900">¥{r.avgPrice.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">¥{r.minPrice.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">¥{r.maxPrice.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">¥{r.avgCost.toFixed(2)}</td>
                        <td className={`px-4 py-2.5 text-right font-medium ${r.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                          ¥{r.profit.toFixed(2)}
                        </td>
                        <td className={`px-4 py-2.5 text-right ${r.margin >= 0 ? "text-green-700" : "text-red-600"}`}>
                          {r.margin.toFixed(2)}%
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-500">{r.lastDate}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 交易明细 */}
          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-900">
              交易明细
              {detailCapped && <span className="ml-2 text-xs font-normal text-gray-400">仅显示最近 500 笔</span>}
            </h2>
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">日期</th>
                    <th className="px-4 py-3 font-medium">单号</th>
                    <th className="px-4 py-3 font-medium">客户</th>
                    <th className="px-4 py-3 text-right font-medium">数量</th>
                    <th className="px-4 py-3 text-right font-medium">售价</th>
                    <th className="px-4 py-3 text-right font-medium">成本单价</th>
                    <th className="px-4 py-3 text-right font-medium">毛利额</th>
                    <th className="px-4 py-3 text-right font-medium">毛利率</th>
                    <th className="px-4 py-3 text-right font-medium">销售额</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {detailRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                        该期间无销售数据
                      </td>
                    </tr>
                  )}
                  {detailRows.map((p, i) => {
                    const margin = p.amount > 0 ? (p.profit / p.amount) * 100 : 0;
                    return (
                      <tr key={i}>
                        <td className="px-4 py-2.5 text-gray-900">{p.date}</td>
                        <td className="px-4 py-2.5 text-gray-500">{p.orderNo}</td>
                        <td className="px-4 py-2.5 text-gray-900">{p.customer}</td>
                        <td className="px-4 py-2.5 text-right text-gray-900">{p.qty.toFixed(3)}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-900">¥{p.unitPrice.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right text-[#ea580c]">¥{p.unitCost.toFixed(2)}</td>
                        <td className={`px-4 py-2.5 text-right font-medium ${p.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                          ¥{p.profit.toFixed(2)}
                        </td>
                        <td className={`px-4 py-2.5 text-right ${margin >= 0 ? "text-green-700" : "text-red-600"}`}>
                          {margin.toFixed(2)}%
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-900">¥{p.amount.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function resolveRange(from?: string, to?: string) {
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return {
      gte: new Date(`${from}T00:00:00`),
      lte: new Date(`${to}T23:59:59.999`),
      label: `${from} ~ ${to}`,
    };
  }
  // 默认全部记录：价格走势需要尽量长的时间跨度
  return {
    gte: new Date(2000, 0, 1),
    lte: new Date(2100, 11, 31, 23, 59, 59, 999),
    label: "全部记录",
  };
}

function SummaryCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`mt-2 text-xl font-semibold ${highlight === undefined ? "text-gray-900" : highlight ? "text-green-700" : "text-red-600"}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-gray-400">{sub}</div>}
    </div>
  );
}
