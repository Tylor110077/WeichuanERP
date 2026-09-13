import { redirect } from "next/navigation";
import { FilterForm } from "@/components/filter-form";
import { SearchInput } from "@/components/search-input";
import { EmptyState } from "@/components/empty-state";
import { badgeDanger, badgeMuted, badgeOk, badgePending, btnPrimary, btnSecondary, inputBase } from "@/lib/ui";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { DraftResumeLink } from "@/components/draft-resume-link";
import { prisma } from "@/lib/prisma";
import { pinyinQuery } from "@/lib/pinyin";
import { initials } from "@/lib/pinyin";
import { DateShortcuts } from "@/components/date-shortcuts";
import { SearchSelect } from "@/components/search-select";
import { ROLE_LABELS } from "@/lib/auth/roles";

export const metadata = { title: "进货单 - 玮川进销存" };

const PAGE_SIZE = 20;
const STATUS_LABELS: Record<string, string> = {
  pending: "待收货",
  received: "已入库",
  voided: "已作废",
};

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; from?: string; to?: string; supplierId?: string; q?: string; settle?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = params.status || undefined;
  const supplierId = params.supplierId ? Number(params.supplierId) : undefined;
  const q = params.q?.trim();
  const settle =
    params.settle === "settled" || params.settle === "unsettled" ? params.settle : undefined;
  const range = dateRange(params.from, params.to);

  // 付款结清筛选：未结清 = 应付 − 已付 − 未作废退货冲减 > 0（不含已作废单）
  let settleIds: number[] | null = null;
  if (settle === "settled") {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT po.id FROM purchase_orders po
      LEFT JOIN (
        SELECT purchase_order_id, SUM(total_amount) AS t
        FROM purchase_returns WHERE status = 'confirmed' GROUP BY purchase_order_id
      ) pr ON pr.purchase_order_id = po.id
      WHERE po.status IN ('pending', 'received')
        AND (po.total_amount - po.paid_amount - COALESCE(pr.t, 0)) <= 0`;
    settleIds = rows.map((r) => r.id);
  } else if (settle === "unsettled") {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT po.id FROM purchase_orders po
      LEFT JOIN (
        SELECT purchase_order_id, SUM(total_amount) AS t
        FROM purchase_returns WHERE status = 'confirmed' GROUP BY purchase_order_id
      ) pr ON pr.purchase_order_id = po.id
      WHERE po.status IN ('pending', 'received')
        AND (po.total_amount - po.paid_amount - COALESCE(pr.t, 0)) > 0`;
    settleIds = rows.map((r) => r.id);
  }

  const where = {
    ...(status ? { status: status as "pending" | "received" | "voided" } : {}),
    ...(supplierId ? { supplierId } : {}),
    // 单据号 + 厂家名（中文或拼音首字母，如 yddl 找到远东电缆的单）
    ...(q
      ? {
          OR: [
            { orderNo: { contains: q } },
            { supplier: { name: { contains: q } } },
            { supplier: { searchPinyin: { contains: pinyinQuery(q) } } },
          ],
        }
      : {}),
    ...(settleIds ? { id: { in: settleIds } } : {}),
    createdAt: { gte: range.gte, lte: range.lte },
    // 矩阵：业务员只能看自己开的单
    ...(user.role === "sales" ? { operatorId: user.id } : {}),
  };

  const [total, orders, suppliers] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        supplier: { select: { name: true } },
        operator: { select: { displayName: true, role: true } },
        returns: { where: { status: "confirmed" }, select: { totalAmount: true } },
      },
    }),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const statusOptions = [
    { value: "", label: "全部状态" },
    { value: "pending", label: "待收货" },
    { value: "received", label: "已入库" },
    { value: "voided", label: "已作废" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">进货单</h1>
        {user.role !== "boss" && (
          <div className="flex flex-wrap items-center gap-2">
            <DraftResumeLink scope="purchase" userId={user.id} href="/purchase-orders/new" label="继续未完成的进货单" />
            <Link
              href="/purchase-orders/new"
              className={btnPrimary}
            >
              新建进货单
            </Link>
          </div>
        )}
      </div>

      <DateShortcuts
        basePath="/purchase-orders"
        extraQuery={{
          supplierId: supplierId != null ? String(supplierId) : "",
          q: q ?? "",
          status: status ?? "",
          settle: settle ?? "",
        }}
      />

      <FilterForm className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <SearchInput
          name="q"
          type="text"
          placeholder="单据号 / 厂家名"
          defaultValue={q}
          className={`${inputBase} w-40`}
        />
        <SearchSelect
          name="supplierId"
          options={suppliers.map((s) => ({ value: String(s.id), label: s.name, py: initials(s.name) }))}
          defaultValue={supplierId != null ? String(supplierId) : ""}
          noneLabel="全部厂家"
          placeholder="厂家（可搜索）"
          className="w-52"
        />
        <input type="date" name="from" defaultValue={params.from} className={`${inputBase}`} />
        <input type="date" name="to" defaultValue={params.to} className={`${inputBase}`} />
        <select name="status" defaultValue={status ?? ""} className={`${inputBase}`}>
          {statusOptions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select name="settle" defaultValue={settle ?? ""} className={`${inputBase}`}>
          <option value="">全部款项</option>
          <option value="unsettled">未结清</option>
          <option value="settled">已结清</option>
        </select>
        <button
          type="submit"
          className={btnSecondary}
        >
          筛选
        </button>
        <span className="text-xs text-gray-500">共 {total} 张</span>
      </FilterForm>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                {/* 列多（10 列）：给表格一个最小宽度，宁可窄屏左右滑动，也不要把每格压成六七行
            或把「泰山」拆成竖排两字。实测 72rem 时行高 141px→41px，且短内容都能单行放下。 */}
        <table className="w-full min-w-[72rem] divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-3 font-medium">单据号</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">厂家</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">状态</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">金额</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">已付</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">款项</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">来源</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">操作人</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">开单时间</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
            {orders.length === 0 && (
              <tr>
                <td colSpan={10}>
                  <EmptyState title="还没有进货单" hint="点右上角「新建进货单」录入进货" action={{ href: "/purchase-orders/new", label: "+ 新建进货单" }} />
                </td>
              </tr>
            )}
            {orders.map((o) => {
              const returned = o.returns.reduce((sum, r) => sum + Number(r.totalAmount), 0);
              const outstanding = Number(o.totalAmount) - Number(o.paidAmount) - returned;
              return (
              <tr key={o.id}>
                <td className="whitespace-nowrap px-4 py-2.5 font-medium text-gray-900">{o.orderNo}</td>
                <td className="px-4 py-2.5 text-gray-900">{o.supplier.name}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={
                      o.status === "received"
                        ? badgeOk
                        : o.status === "voided"
                          ? badgeMuted
                          : badgePending
                    }
                  >
                    {STATUS_LABELS[o.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-gray-900 tabular-nums">¥{Number(o.totalAmount).toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">¥{Number(o.paidAmount).toFixed(2)}</td>
                <td className="px-4 py-2.5">
                  {o.status === "voided" ? (
                    <span className="text-xs text-gray-400">—</span>
                  ) : outstanding <= 0 ? (
                    <span className={badgeOk}>
                      已结清
                    </span>
                  ) : (
                    <span className={`whitespace-nowrap ${badgeDanger}`}>
                      未结清 ¥{outstanding.toFixed(2)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-gray-600">
                  {o.sourceType === "auto" ? "自动补货" : "手动"}
                </td>
                <td className="px-4 py-2.5 text-gray-600">
                  {o.operator.displayName}（{ROLE_LABELS[o.operator.role]}）
                </td>
                <td className="px-4 py-2.5 text-gray-600">
                  {o.createdAt.toLocaleString("zh-CN")}
                </td>
                <td className="px-4 py-2.5">
                  {/* 同上：详情与付款登记是同一个页面，只留一个入口 */}
                  <Link
                    href={`/purchase-orders/${o.id}${o.status !== "voided" && outstanding > 0 ? "#payment" : ""}`}
                    className="whitespace-nowrap text-blue-600 hover:underline"
                    title={
                      o.status !== "voided" && outstanding > 0
                        ? "打开单据详情，并直接跳到付款登记处"
                        : "打开单据详情"
                    }
                  >
                    详情 / 登记
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
              <Link href={buildHref(page - 1)} className="text-blue-600 hover:underline">
                上一页
              </Link>
            ) : (
              <span className="text-gray-400">上一页</span>
            )}
            <span className="text-gray-600">
              第 {page} / {totalPages} 页
            </span>
            {page < totalPages ? (
              <Link href={buildHref(page + 1)} className="text-blue-600 hover:underline">
                下一页
              </Link>
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
    if (supplierId) sp.set("supplierId", String(supplierId));
    if (status) sp.set("status", status);
    if (settle) sp.set("settle", settle);
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
    sp.set("page", String(p));
    return `/purchase-orders?${sp.toString()}`;
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
