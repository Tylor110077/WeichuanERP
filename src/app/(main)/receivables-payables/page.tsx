import { redirect } from "next/navigation";
import { FilterForm } from "@/components/filter-form";
import { EmptyState, NoPermission } from "@/components/empty-state";
import { btnSecondary, segActive, segIdle } from "@/lib/ui";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DateShortcuts } from "@/components/date-shortcuts";
import { SearchSelect } from "@/components/search-select";

export const metadata = { title: "应收应付 - 玮川进销存" };

/**
 * 应收应付：一个视图（应收/应付切换）+ 顶部合计 + 统一筛选（日期快捷/对象/方式），
 * 下方为未结清单据表；点行内「详情 / 登记」进入单据详情页登记收付款（历史收付流水也在那里查阅/撤销）。
 */
export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    from?: string;
    to?: string;
    counterId?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "sales") {
    return (
      <NoPermission text="无权限访问应收应付（管理员/老板）" />
    );
  }

  const params = await searchParams;
  const view = params.view === "payable" ? "payable" : "receivable";
  const isReceivable = view === "receivable";
  const range = dateRange(params.from, params.to);
  const counterId = params.counterId ? Number(params.counterId) : undefined;

  const orders = isReceivable
    ? await prisma.saleOrder.findMany({
        where: { status: "confirmed", createdAt: { gte: range.gte, lte: range.lte }, ...(counterId ? { customerId: counterId } : {}) },
        include: {
          customer: { select: { name: true } },
          returns: { where: { status: "confirmed" } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      })
    : await prisma.purchaseOrder.findMany({
        where: { status: { in: ["pending", "received"] }, createdAt: { gte: range.gte, lte: range.lte }, ...(counterId ? { supplierId: counterId } : {}) },
        include: {
          supplier: { select: { name: true } },
          returns: { where: { status: "confirmed" } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });

  // 汇总：合计 + 按对方。
  // 注意：这里必须用 SQL 聚合，不能拿上面 take:200 的结果在内存里求和——
  // 那样一旦单据超过 200 张，合计会静默少算，且与工作台的「应收/应付总额」出现两个不同的数。
  const counterRows = isReceivable
    ? await prisma.$queryRaw<
        { counterId: number; name: string; total: number | null; unsettled: number | bigint | null }[]
      >`
        SELECT so.customer_id AS counterId, c.name AS name,
               COALESCE(SUM(GREATEST(so.total_amount - so.received_amount - COALESCE(sr.total, 0), 0)), 0) AS total,
               COALESCE(SUM(CASE WHEN so.total_amount - so.received_amount - COALESCE(sr.total, 0) > 0 THEN 1 ELSE 0 END), 0) AS unsettled
        FROM sale_orders so
        JOIN customers c ON c.id = so.customer_id
        LEFT JOIN (
          SELECT sale_order_id, SUM(total_amount) AS total FROM sale_returns WHERE status = 'confirmed' GROUP BY sale_order_id
        ) sr ON sr.sale_order_id = so.id
        WHERE so.status = 'confirmed' AND so.created_at >= ${range.gte} AND so.created_at <= ${range.lte}
          ${counterId ? Prisma.sql`AND so.customer_id = ${counterId}` : Prisma.empty}
        GROUP BY so.customer_id, c.name
        ORDER BY total DESC`
    : await prisma.$queryRaw<
        { counterId: number; name: string; total: number | null; unsettled: number | bigint | null }[]
      >`
        SELECT po.supplier_id AS counterId, s.name AS name,
               COALESCE(SUM(GREATEST(po.total_amount - po.paid_amount - COALESCE(pr.total, 0), 0)), 0) AS total,
               COALESCE(SUM(CASE WHEN po.total_amount - po.paid_amount - COALESCE(pr.total, 0) > 0 THEN 1 ELSE 0 END), 0) AS unsettled
        FROM purchase_orders po
        JOIN suppliers s ON s.id = po.supplier_id
        LEFT JOIN (
          SELECT purchase_order_id, SUM(total_amount) AS total FROM purchase_returns WHERE status = 'confirmed' GROUP BY purchase_order_id
        ) pr ON pr.purchase_order_id = po.id
        WHERE po.status IN ('pending', 'received') AND po.created_at >= ${range.gte} AND po.created_at <= ${range.lte}
          ${counterId ? Prisma.sql`AND po.supplier_id = ${counterId}` : Prisma.empty}
        GROUP BY po.supplier_id, s.name
        ORDER BY total DESC`;

  const totalOutstanding = counterRows.reduce((s, r) => s + Number(r.total ?? 0), 0);
  const unsettledCount = counterRows.reduce((s, r) => s + Number(r.unsettled ?? 0), 0);
  const byCounter = counterRows.map((r) => ({ id: Number(r.counterId), name: r.name, total: Number(r.total ?? 0) }));

  // 未结清单据行（表格最多展示 200 张，超出时在表头提示，合计不受此限制）
  const unpaidOrders = orders.filter((o) => {
    const returned = o.returns.reduce((r, x) => r + Number(x.totalAmount), 0);
    const paid = isReceivable ? Number((o as { receivedAmount: unknown }).receivedAmount) : Number((o as { paidAmount: unknown }).paidAmount);
    const total = Number((o as { totalAmount: unknown }).totalAmount);
    return total - paid - returned > 0;
  });
  const counterOptions =
    isReceivable
      ? await prisma.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : await prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  const isDefaultRange = !params.from && !params.to;

  const viewHref = (v: string) => {
    const sp = new URLSearchParams({ view: v });
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
    if (params.counterId) sp.set("counterId", params.counterId);

    return `/receivables-payables?${sp.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">应收应付</h1>
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm">
          <a
            href={viewHref("receivable")}
            className={`px-4 py-1.5 ${isReceivable ? segActive : segIdle}`}
          >
            应收（客户）
          </a>
          <a
            href={viewHref("payable")}
            className={`px-4 py-1.5 ${!isReceivable ? segActive : segIdle}`}
          >
            应付（厂家）
          </a>
        </div>
      </div>

      <DateShortcuts
        basePath="/receivables-payables"
        extraQuery={{ view, counterId: params.counterId ?? "" }}
      />
      <FilterForm className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <label htmlFor="from" className="block text-xs font-medium text-gray-600">开始日期</label>
          <input id="from" type="date" name="from" defaultValue={params.from} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label htmlFor="to" className="block text-xs font-medium text-gray-600">结束日期</label>
          <input id="to" type="date" name="to" defaultValue={params.to} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <SearchSelect
          name="counterId"
          options={counterOptions.map((c) => ({ value: String(c.id), label: c.name }))}
          defaultValue={params.counterId ?? ""}
          noneLabel={isReceivable ? "全部客户" : "全部厂家"}
          placeholder={isReceivable ? "客户（可搜索）" : "厂家（可搜索）"}
          className="w-52"
        />
        <input type="hidden" name="view" value={view} />
        <button type="submit" className={btnSecondary}>查询</button>
        {(params.from || params.to || params.counterId) && (
          <Link href={`/receivables-payables?view=${view}`} className="text-xs text-blue-600 hover:underline">清除条件</Link>
        )}
      </FilterForm>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">
          未结清单据（{isReceivable ? "应收" : "应付"}）
          <span className="ml-2 text-xs font-normal text-gray-400">
            共 {unsettledCount} 张 ・ 点右侧「详情 / 登记」进单据登记
            {unsettledCount > unpaidOrders.length && `（下表仅显示最近 ${unpaidOrders.length} 张，合计已含全部）`}
          </span>
        </div>
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">日期</th>
              <th className="px-4 py-3 font-medium">单号</th>
              <th className="px-4 py-3 font-medium">{isReceivable ? "客户" : "厂家"}</th>
              <th className="px-4 py-3 text-right font-medium tabular-nums">{isReceivable ? "应收" : "应付"}</th>
              <th className="px-4 py-3 text-right font-medium tabular-nums">{isReceivable ? "已收" : "已付"}</th>
              <th className="px-4 py-3 text-right font-medium tabular-nums">退货冲减</th>
              <th className="px-4 py-3 text-right font-medium tabular-nums">{isReceivable ? "未收" : "未付"}</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
            {unpaidOrders.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    title="当前筛选条件下单据已全部结清"
                    hint="调整上方筛选条件可查看其他单据"
                  />
                </td>
              </tr>
            )}
            {unpaidOrders.map((o) => {
              const returned = o.returns.reduce((r, x) => r + Number(x.totalAmount), 0);
              const paid = isReceivable ? Number((o as { receivedAmount: unknown }).receivedAmount) : Number((o as { paidAmount: unknown }).paidAmount);
              const total = Number((o as { totalAmount: unknown }).totalAmount);
              const unpaid = Math.max(0, total - paid - returned);
              const counterName = isReceivable
                ? (o as { customer: { name: string } }).customer.name
                : (o as { supplier: { name: string } }).supplier.name;
              const detailHref = isReceivable ? `/sale-orders/${o.id}` : `/purchase-orders/${o.id}`;
              return (
                <tr key={o.id}>
                  <td className="px-4 py-2.5 text-gray-600">{o.createdAt.toLocaleDateString("zh-CN")}</td>
                  <td className="px-4 py-2.5">
                    <Link href={detailHref} className="font-medium text-blue-600 hover:underline">{o.orderNo}</Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-900">{counterName}</td>
                  <td className="px-4 py-2.5 text-right text-gray-900 tabular-nums">¥{total.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">¥{paid.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right text-orange-600 tabular-nums">¥{returned.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-red-600 tabular-nums">¥{unpaid.toFixed(2)}</td>
                  <td className="px-4 py-2.5">
                    <Link href={detailHref} className="text-xs text-blue-600 hover:underline">详情 / 登记</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 合计：放在单据表下方，直观反映当前筛选条件下共多少未结清 */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm text-gray-500">
            {isReceivable ? "客户应收合计（未收）" : "厂家应付合计（未付）"}
            <span className="ml-2 text-xs text-gray-400">
              {isDefaultRange ? "默认本月 1 号至今" : `${params.from || "最早"} ~ ${params.to || "今天"}`}
              {" ・ "}
              {unsettledCount} 张未结清
              {counterId ? "・已筛选单个对象" : ""}
            </span>
          </div>
          <div className="text-2xl font-semibold text-red-600">¥{totalOutstanding.toFixed(2)}</div>
        </div>
        {byCounter.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-gray-100 pt-3">
            {byCounter.map((v) => (
              <div key={v.id} className="flex justify-between text-sm">
                <span className="text-gray-700">{v.name}</span>
                <span className="text-gray-900 tabular-nums">¥{v.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-400">
          口径：单额 − 已{isReceivable ? "收" : "付"} − 未作废退货冲减，只统计{isReceivable ? "非作废售卖单" : "未作废进货单"}。
          工作台的「{isReceivable ? "应收" : "应付"}总额」是全部时间的累计值，与这里按筛选期间统计的数字含义不同。
        </p>
      </div>
    </div>
  );
}

function dateRange(from?: string, to?: string): { gte: Date; lte: Date } {
  const now = new Date();
  const gte = from && /^\d{4}-\d{2}-\d{2}$/.test(from)
    ? new Date(`${from}T00:00:00`)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const toDate = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T00:00:00`) : now;
  const lte = new Date(toDate.getTime());
  lte.setHours(23, 59, 59, 999);
  return { gte, lte };
}
