import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { DateShortcuts } from "@/components/date-shortcuts";
import { PaymentForm } from "./payment-form";

export const metadata = { title: "应收应付 - 玮川进销存" };

/**
 * 应收应付：一个视图（应收/应付切换）+ 顶部合计 + 统一筛选（日期快捷/对象/方式），
 * 下方为未结清单据表与收付款登记。历史收付流水请在单据详情页查阅/撤销。
 */
export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    from?: string;
    to?: string;
    counterId?: string;
    method?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "sales") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限访问应收应付（管理员/老板）
      </div>
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

  // 汇总：合计 + 按对方
  const totalOutstanding = orders.reduce((s, o) => {
    const returned = o.returns.reduce((r, x) => r + Number(x.totalAmount), 0);
    const paid = isReceivable ? Number((o as { receivedAmount: unknown }).receivedAmount) : Number((o as { paidAmount: unknown }).paidAmount);
    const total = Number((o as { totalAmount: unknown }).totalAmount);
    return s + Math.max(0, total - paid - returned);
  }, 0);

  const byCounter = new Map<number, { name: string; total: number }>();
  for (const o of orders) {
    const returned = o.returns.reduce((r, x) => r + Number(x.totalAmount), 0);
    const paid = isReceivable ? Number((o as { receivedAmount: unknown }).receivedAmount) : Number((o as { paidAmount: unknown }).paidAmount);
    const total = Number((o as { totalAmount: unknown }).totalAmount);
    const key = isReceivable ? (o as { customerId: number }).customerId : (o as { supplierId: number }).supplierId;
    const name = isReceivable ? (o as { customer: { name: string } }).customer.name : (o as { supplier: { name: string } }).supplier.name;
    const cur = byCounter.get(key) ?? { name, total: 0 };
    cur.total += Math.max(0, total - paid - returned);
    byCounter.set(key, cur);
  }

  // 未结清单据行
  const unpaidOrders = orders.filter((o) => {
    const returned = o.returns.reduce((r, x) => r + Number(x.totalAmount), 0);
    const paid = isReceivable ? Number((o as { receivedAmount: unknown }).receivedAmount) : Number((o as { paidAmount: unknown }).paidAmount);
    const total = Number((o as { totalAmount: unknown }).totalAmount);
    return total - paid - returned > 0;
  });
  const unpaidSum = unpaidOrders.reduce((s, o) => {
    const returned = o.returns.reduce((r, x) => r + Number(x.totalAmount), 0);
    const paid = isReceivable ? Number((o as { receivedAmount: unknown }).receivedAmount) : Number((o as { paidAmount: unknown }).paidAmount);
    const total = Number((o as { totalAmount: unknown }).totalAmount);
    return s + Math.max(0, total - paid - returned);
  }, 0);

  // 未结清单（登记表单用，与筛选一致）
  const sales = isReceivable
    ? unpaidOrders.map((o) => {
        const returned = o.returns.reduce((r, x) => r + Number(x.totalAmount), 0);
        const received = Number((o as { receivedAmount: unknown }).receivedAmount);
        const total = Number((o as { totalAmount: unknown }).totalAmount);
        return {
          id: o.id,
          orderNo: o.orderNo,
          customerName: (o as { customer: { name: string } }).customer.name,
          outstanding: Math.max(0, total - received - returned),
        };
      })
    : [];
  const purchases = !isReceivable
    ? unpaidOrders.map((o) => {
        const returned = o.returns.reduce((r, x) => r + Number(x.totalAmount), 0);
        const paid = Number((o as { paidAmount: unknown }).paidAmount);
        const total = Number((o as { totalAmount: unknown }).totalAmount);
        return {
          id: o.id,
          orderNo: o.orderNo,
          supplierName: (o as { supplier: { name: string } }).supplier.name,
          outstanding: Math.max(0, total - paid - returned),
        };
      })
    : [];

  const counterOptions =
    isReceivable
      ? await prisma.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : await prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  const viewHref = (v: string) => {
    const sp = new URLSearchParams({ view: v });
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
    if (params.counterId) sp.set("counterId", params.counterId);

    return `/receivables-payables?${sp.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">应收应付</h1>
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm">
          <a
            href={viewHref("receivable")}
            className={`rounded-md px-4 py-1.5 ${isReceivable ? "bg-blue-600 text-white" : "text-gray-600 hover:text-gray-900"}`}
          >
            应收（客户）
          </a>
          <a
            href={viewHref("payable")}
            className={`rounded-md px-4 py-1.5 ${!isReceivable ? "bg-blue-600 text-white" : "text-gray-600 hover:text-gray-900"}`}
          >
            应付（供应商）
          </a>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="text-sm text-gray-500">
          {isReceivable ? "客户应收合计（未收）" : "供应商应付合计（未付）"} ・ 当前筛选条件
        </div>
        <div className="mt-1 text-2xl font-semibold text-gray-900">¥{totalOutstanding.toFixed(2)}</div>
        <div className="mt-2 space-y-1">
          {[...byCounter.entries()]
            .sort((a, b) => b[1].total - a[1].total)
            .map(([id, v]) => (
              <div key={id} className="flex justify-between text-sm">
                <span className="text-gray-700">{v.name}</span>
                <span className="text-gray-900">¥{v.total.toFixed(2)}</span>
              </div>
            ))}
        </div>
      </div>

      <DateShortcuts
        basePath="/receivables-payables"
        extraQuery={{ view, counterId: params.counterId ?? "" }}
      />
      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <label htmlFor="from" className="block text-xs font-medium text-gray-600">开始日期</label>
          <input id="from" type="date" name="from" defaultValue={params.from} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label htmlFor="to" className="block text-xs font-medium text-gray-600">结束日期</label>
          <input id="to" type="date" name="to" defaultValue={params.to} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <select name="counterId" defaultValue={params.counterId ?? ""} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">{isReceivable ? "全部客户" : "全部供应商"}</option>
          {counterOptions.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input type="hidden" name="view" value={view} />
        <button type="submit" className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200">查询</button>
        {(params.from || params.to || params.counterId) && (
          <Link href={`/receivables-payables?view=${view}`} className="text-xs text-blue-600 hover:underline">清除条件</Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">
          未结清单据（{isReceivable ? "应收" : "应付"}）
          <span className="ml-2 text-xs font-normal text-gray-400">
            共 {unpaidOrders.length} 张 ・ 待{isReceivable ? "收" : "付"} ¥{unpaidSum.toFixed(2)} ・ 点单号进详情登记
          </span>
        </div>
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">日期</th>
              <th className="px-4 py-3 font-medium">单号</th>
              <th className="px-4 py-3 font-medium">{isReceivable ? "客户" : "供应商"}</th>
              <th className="px-4 py-3 text-right font-medium">{isReceivable ? "应收" : "应付"}</th>
              <th className="px-4 py-3 text-right font-medium">{isReceivable ? "已收" : "已付"}</th>
              <th className="px-4 py-3 text-right font-medium">退货冲减</th>
              <th className="px-4 py-3 text-right font-medium">{isReceivable ? "未收" : "未付"}</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {unpaidOrders.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  当前筛选条件下单据已全部结清
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
                  <td className="px-4 py-2.5 text-right text-gray-900">¥{total.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">¥{paid.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right text-orange-600">¥{returned.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-red-600">¥{unpaid.toFixed(2)}</td>
                  <td className="px-4 py-2.5">
                    <Link href={detailHref} className="text-xs text-blue-600 hover:underline">详情 / 登记</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <PaymentForm saleOrders={sales} purchaseOrders={purchases} lockedDirection={isReceivable ? "receipt" : "payment"} />
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
