import { redirect } from "next/navigation";
import { FilterForm } from "@/components/filter-form";
import { EmptyState } from "@/components/empty-state";
import { btnPrimary, btnSecondary } from "@/lib/ui";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { DateShortcuts } from "@/components/date-shortcuts";
import { SearchSelect } from "@/components/search-select";
import { ROLE_LABELS } from "@/lib/auth/roles";

export const metadata = { title: "售卖单 - 玮川进销存" };

const PAGE_SIZE = 20;
const STATUS_LABELS: Record<string, string> = {
  confirmed: "已开单",
  voided: "已作废",
};

export default async function SaleOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; from?: string; to?: string; customerId?: string; q?: string; settle?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = params.status || undefined;
  const customerId = params.customerId ? Number(params.customerId) : undefined;
  const q = params.q?.trim();
  const settle =
    params.settle === "settled" || params.settle === "unsettled" ? params.settle : undefined;
  const range = dateRange(params.from, params.to);

  // 款项结清筛选：未结清 = 应收 − 已收 − 未作废退货冲减 > 0（仅统计已开单）
  let settleIds: number[] | null = null;
  if (settle === "settled") {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT so.id FROM sale_orders so
      LEFT JOIN (
        SELECT sale_order_id, SUM(total_amount) AS t
        FROM sale_returns WHERE status = 'confirmed' GROUP BY sale_order_id
      ) sr ON sr.sale_order_id = so.id
      WHERE so.status = 'confirmed'
        AND (so.total_amount - so.received_amount - COALESCE(sr.t, 0)) <= 0`;
    settleIds = rows.map((r) => r.id);
  } else if (settle === "unsettled") {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT so.id FROM sale_orders so
      LEFT JOIN (
        SELECT sale_order_id, SUM(total_amount) AS t
        FROM sale_returns WHERE status = 'confirmed' GROUP BY sale_order_id
      ) sr ON sr.sale_order_id = so.id
      WHERE so.status = 'confirmed'
        AND (so.total_amount - so.received_amount - COALESCE(sr.t, 0)) > 0`;
    settleIds = rows.map((r) => r.id);
  }

  const where = {
    ...(status ? { status: status as "confirmed" | "voided" } : {}),
    ...(customerId ? { customerId } : {}),
    ...(q ? { orderNo: { contains: q } } : {}),
    ...(settleIds ? { id: { in: settleIds } } : {}),
    createdAt: { gte: range.gte, lte: range.lte },
    ...(user.role === "sales" ? { operatorId: user.id } : {}),
  };

  const [total, orders, customers] = await Promise.all([
    prisma.saleOrder.count({ where }),
    prisma.saleOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        customer: { select: { name: true } },
        operator: { select: { displayName: true, role: true } },
        returns: { where: { status: "confirmed" }, select: { totalAmount: true } },
      },
    }),
    prisma.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">售卖单</h1>
        {user.role !== "boss" && (
          <Link
            href="/sale-orders/new"
            className={btnPrimary}
          >
            新建售卖单
          </Link>
        )}
      </div>

      <DateShortcuts
        basePath="/sale-orders"
        extraQuery={{
          customerId: customerId != null ? String(customerId) : "",
          q: q ?? "",
          status: status ?? "",
          settle: settle ?? "",
        }}
      />

      <FilterForm className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <input
          name="q"
          type="text"
          placeholder="单据号搜索"
          defaultValue={q}
          className="w-40 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
        <SearchSelect
          name="customerId"
          options={customers.map((c) => ({ value: String(c.id), label: c.name }))}
          defaultValue={customerId != null ? String(customerId) : ""}
          noneLabel="全部客户"
          placeholder="客户（可搜索）"
          className="w-52"
        />
        <input type="date" name="from" defaultValue={params.from} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <input type="date" name="to" defaultValue={params.to} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <select name="status" defaultValue={status ?? ""} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">全部状态</option>
          <option value="confirmed">已开单</option>
          <option value="voided">已作废</option>
        </select>
        <select name="settle" defaultValue={settle ?? ""} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">全部款项</option>
          <option value="unsettled">未结清</option>
          <option value="settled">已结清</option>
        </select>
        <button type="submit" className={btnSecondary}>
          筛选
        </button>
        <span className="text-xs text-gray-500">共 {total} 张</span>
      </FilterForm>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">单据号</th>
              <th className="px-4 py-3 font-medium">客户</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">金额</th>
              <th className="px-4 py-3 font-medium">已收</th>
              <th className="px-4 py-3 font-medium">款项</th>
              <th className="px-4 py-3 font-medium">操作人</th>
              <th className="px-4 py-3 font-medium">开单时间</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {orders.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <EmptyState title="还没有售卖单" hint="点右上角「新建售卖单」开始开单" action={{ href: "/sale-orders/new", label: "+ 新建售卖单" }} />
                </td>
              </tr>
            )}
            {orders.map((o) => {
              const returned = o.returns.reduce((sum, r) => sum + Number(r.totalAmount), 0);
              const outstanding = Number(o.totalAmount) - Number(o.receivedAmount) - returned;
              return (
              <tr key={o.id}>
                <td className="px-4 py-2.5 font-medium text-gray-900">{o.orderNo}</td>
                <td className="px-4 py-2.5 text-gray-900">{o.customer.name}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={
                      o.status === "confirmed"
                        ? "rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700"
                        : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                    }
                  >
                    {STATUS_LABELS[o.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-900">¥{Number(o.totalAmount).toFixed(2)}</td>
                <td className="px-4 py-2.5 text-gray-600">¥{Number(o.receivedAmount).toFixed(2)}</td>
                <td className="px-4 py-2.5">
                  {o.status === "voided" ? (
                    <span className="text-xs text-gray-400">—</span>
                  ) : outstanding <= 0 ? (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                      已结清
                    </span>
                  ) : (
                    <span className="whitespace-nowrap text-xs text-red-600">
                      未结清 ¥{outstanding.toFixed(2)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-gray-600">
                  {o.operator.displayName}（{ROLE_LABELS[o.operator.role]}）
                </td>
                <td className="px-4 py-2.5 text-gray-600">{o.createdAt.toLocaleString("zh-CN")}</td>
                <td className="px-4 py-2.5">
                  <Link href={`/sale-orders/${o.id}`} className="text-blue-600 hover:underline">
                    详情
                  </Link>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex items-center gap-3 border-t border-gray-100 px-4 py-3 text-sm">
            {page > 1 ? (
              <Link href={buildHref(page - 1)} className="text-blue-600 hover:underline">上一页</Link>
            ) : (
              <span className="text-gray-400">上一页</span>
            )}
            <span className="text-gray-600">第 {page} / {totalPages} 页</span>
            {page < totalPages ? (
              <Link href={buildHref(page + 1)} className="text-blue-600 hover:underline">下一页</Link>
            ) : (
              <span className="text-gray-400">下一页</span>
            )}
          </div>
        )}
      </div>
    </div>
  );

  function buildHref(p: number): string {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (customerId) sp.set("customerId", String(customerId));
    if (status) sp.set("status", status);
    if (settle) sp.set("settle", settle);
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
    sp.set("page", String(p));
    return `/sale-orders?${sp.toString()}`;
  }
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
