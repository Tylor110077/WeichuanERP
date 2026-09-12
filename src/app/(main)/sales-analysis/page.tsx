import { redirect } from "next/navigation";
import Link from "next/link";
import { FilterForm } from "@/components/filter-form";
import { EmptyState, NoPermission } from "@/components/empty-state";
import { btnSecondary, inputBase } from "@/lib/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { DateShortcuts } from "@/components/date-shortcuts";
import { RelatedLinks } from "@/components/related-links";

const PAGE_SIZE = 50;

export const metadata = { title: "销售分析 - 玮川进销存" };

/**
 * 销售分析：按日/周/自定义期间筛选，展示销售额/成本/总利润/利润率，
 * 商品维度（销量/销售额/成本/利润/利润率）与按日汇总列表。
 * 口径：非作废售卖单，成本按单据成本快照（与单据详情/报表中心一致）。
 */
export default async function SalesAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ quick?: string; from?: string; to?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "sales") {
    return (
      <NoPermission text="无权限访问销售分析（管理员/老板）" />
    );
  }

  const params = await searchParams;
  const quick = params.quick ?? "month";
  const { gte, lte, label } = resolveRange(quick, params.from, params.to);

  // 数据全部在 SQL 里聚合：原来是把区间内最多 5000 张单连同明细拉进内存再遍历，
  // 单子一多就是这个页面的卡顿来源（性能文档第 8 节记的待办）。
  const where = { status: "confirmed" as const, createdAt: { gte, lte } };

  const [orderAgg, itemAgg, productAgg, dayTotals, dayCosts] = await Promise.all([
    // 单据级：销售额、单数
    prisma.saleOrder.aggregate({ where, _sum: { totalAmount: true }, _count: true }),
    // 明细级：成本快照
    prisma.saleOrderItem.aggregate({ where: { saleOrder: where }, _sum: { costAmount: true } }),
    // 商品维度
    prisma.saleOrderItem.groupBy({
      by: ["productId"],
      where: { saleOrder: where },
      _sum: { quantity: true, amount: true, costAmount: true },
    }),
    // 按日：销售额与单数（DATE(CONVERT_TZ(...)) 把 UTC 存储换算成北京时间的自然日，
    // 与页面上"今天/本周"这些快捷筛选的口径一致）
    prisma.$queryRaw<{ day: Date; orderCount: bigint | number; sales: number | null }[]>`
      SELECT DATE(CONVERT_TZ(so.created_at, '+00:00', '+08:00')) AS day,
             COUNT(*) AS orderCount,
             COALESCE(SUM(so.total_amount), 0) AS sales
      FROM sale_orders so
      WHERE so.status = 'confirmed' AND so.created_at BETWEEN ${gte} AND ${lte}
      GROUP BY day ORDER BY day
    `,
    // 按日：成本（来自明细，按所属单据的日期归集）
    prisma.$queryRaw<{ day: Date; cost: number | null }[]>`
      SELECT DATE(CONVERT_TZ(so.created_at, '+00:00', '+08:00')) AS day,
             COALESCE(SUM(soi.cost_amount), 0) AS cost
      FROM sale_order_items soi
      JOIN sale_orders so ON so.id = soi.sale_order_id
      WHERE so.status = 'confirmed' AND so.created_at BETWEEN ${gte} AND ${lte}
      GROUP BY day ORDER BY day
    `,
  ]);

  const totalSales = Number(orderAgg._sum.totalAmount ?? 0);
  const totalCost = Number(itemAgg._sum.costAmount ?? 0);
  const orderCount = orderAgg._count;
  const totalProfit = totalSales - totalCost;
  const totalMargin = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

  // 商品维度的编码/名称/单位另取一次（groupBy 只能拿到 productId）
  const productIds = productAgg.map((r) => r.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, code: true, name: true, unit: { select: { name: true } } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const productRows = productAgg
    .map((r) => {
      const p = productById.get(r.productId);
      const sales = Number(r._sum.amount ?? 0);
      const cost = Number(r._sum.costAmount ?? 0);
      return {
        code: p?.code ?? "—",
        name: p?.name ?? "（商品已删除）",
        unit: p?.unit.name ?? "",
        qty: Number(r._sum.quantity ?? 0),
        sales,
        cost,
        profit: sales - cost,
        margin: sales > 0 ? ((sales - cost) / sales) * 100 : 0,
      };
    })
    .sort((a, b) => b.profit - a.profit);

  const costByDay = new Map(dayCosts.map((d) => [d.day.toLocaleDateString("zh-CN"), Number(d.cost ?? 0)]));
  const dayRows = dayTotals
    .map((d) => {
      const date = d.day.toLocaleDateString("zh-CN");
      const sales = Number(d.sales ?? 0);
      const cost = costByDay.get(date) ?? 0;
      return { date, count: Number(d.orderCount), sales, cost, profit: sales - cost };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // 商品维度会随商品数量增长：按页展示（默认 50 行/页），而不是只截前 N 行——
  // 截断会让人以为"就这么多"，分页则能看到全部，页面长度也是固定的。
  const productPageCount = Math.max(1, Math.ceil(productRows.length / PAGE_SIZE));
  // 页码夹在有效范围内：换期间后商品变少时，不要把用户留在一个空的第 N 页
  const page = Math.min(Math.max(1, Number(params.page) || 1), productPageCount);
  const pagedProductRows = productRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /** 翻页链接：保留期间筛选（quick/from/to），只改 page */
  const pageHref = (target: number) => {
    const sp = new URLSearchParams();
    if (params.quick) sp.set("quick", params.quick);
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
    if (target > 1) sp.set("page", String(target));
    const qs = sp.toString();
    return `/sales-analysis${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">销售分析</h1>
        <RelatedLinks
          links={[
            { href: "/price-analysis", label: "价格分析（看价）" },
            { href: "/customers?tab=profile", label: "客户画像" },
            { href: "/reports", label: "报表中心（可导出）" },
          ]}
        />
      </div>

      <DateShortcuts basePath="/sales-analysis" />
      <FilterForm className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <label htmlFor="from" className="block text-xs font-medium text-gray-600">自定义开始</label>
          <input id="from" type="date" name="from" defaultValue={params.from} className={`${inputBase} mt-1`} />
        </div>
        <div>
          <label htmlFor="to" className="block text-xs font-medium text-gray-600">自定义结束</label>
          <input id="to" type="date" name="to" defaultValue={params.to} className={`${inputBase} mt-1`} />
        </div>
        <button type="submit" className={btnSecondary}>
          查询
        </button>
        <span className="text-xs text-gray-500">{label} ・ {orderCount} 单</span>
      </FilterForm>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard label="销售额" value={`¥${totalSales.toFixed(2)}`} />
        <SummaryCard label="成本（成本快照）" value={`¥${totalCost.toFixed(2)}`} />
        <SummaryCard label="总利润" value={`¥${totalProfit.toFixed(2)}`} highlight={totalProfit >= 0} />
        <SummaryCard label="总体利润率" value={`${totalMargin.toFixed(2)}%`} highlight={totalMargin >= 0} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">
          商品维度
          <span className="ml-2 text-xs font-normal text-gray-400">
            按利润排序 ・ 共 {productRows.length} 个商品
            {productPageCount > 1 && ` ・ 第 ${page} / ${productPageCount} 页`}
          </span>
        </h2>
        {/* 商品多时页面会很长、DOM 也重：表格内部滚动 + 表头吸顶（同客户组织等长表做法） */}
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-3 font-medium">编码</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">商品</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">单位</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">销量</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">销售额</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">成本</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">利润</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">利润率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
            {productRows.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    title="该期间无销售数据"
                    hint="换个时间范围，或先开一张售卖单"
                    action={{ href: "/sale-orders/new", label: "+ 去开售卖单" }}
                  />
                </td>
              </tr>
            )}
            {pagedProductRows.map((r) => (
              <tr key={r.code}>
                <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{r.code}</td>
                <td className="px-4 py-2.5 text-gray-900">{r.name}</td>
                <td className="px-4 py-2.5 text-gray-600">{r.unit}</td>
                <td className="px-4 py-2.5 text-right text-gray-900 tabular-nums">{r.qty.toFixed(3)}</td>
                <td className="px-4 py-2.5 text-right text-gray-900 tabular-nums">¥{r.sales.toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">¥{r.cost.toFixed(2)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${r.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                  ¥{r.profit.toFixed(2)}
                </td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${r.margin >= 0 ? "text-green-700" : "text-red-600"}`}>
                  {r.margin.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr className="font-medium text-gray-900">
              <td colSpan={4} className="px-4 py-3 text-right">合计</td>
              <td className="px-4 py-3 text-right tabular-nums">¥{totalSales.toFixed(2)}</td>
              <td className="px-4 py-3 text-right tabular-nums">¥{totalCost.toFixed(2)}</td>
              <td className="px-4 py-3 text-right tabular-nums">¥{totalProfit.toFixed(2)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{totalMargin.toFixed(2)}%</td>
            </tr>
          </tfoot>
        </table>
        </div>
        {productPageCount > 1 && (
          <div className="mt-3 flex items-center gap-3 text-sm">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="text-blue-600 hover:underline">上一页</Link>
            ) : (
              <span className="text-gray-400">上一页</span>
            )}
            <span className="text-gray-600">第 {page} / {productPageCount} 页</span>
            {page < productPageCount ? (
              <Link href={pageHref(page + 1)} className="text-blue-600 hover:underline">下一页</Link>
            ) : (
              <span className="text-gray-400">下一页</span>
            )}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">
          按日汇总
          <span className="ml-2 text-xs font-normal text-gray-400">共 {dayRows.length} 天</span>
        </h2>
        <div className="scroll-thin max-h-[24rem] overflow-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-medium">日期</th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">单数</th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">销售额</th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">成本</th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">利润</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
              {dayRows.map((d) => (
                <tr key={d.date}>
                  <td className="px-4 py-2.5 text-gray-900">{d.date}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">{d.count}</td>
                  <td className="px-4 py-2.5 text-right text-gray-900 tabular-nums">¥{d.sales.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">¥{d.cost.toFixed(2)}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${d.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
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
