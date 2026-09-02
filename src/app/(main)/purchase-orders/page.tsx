import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
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
  searchParams: Promise<{ page?: string; status?: string; supplierId?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = params.status || undefined;
  const supplierId = params.supplierId ? Number(params.supplierId) : undefined;
  const q = params.q?.trim();

  const where = {
    ...(status ? { status: status as "pending" | "received" | "voided" } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(q ? { orderNo: { contains: q } } : {}),
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
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">进货单</h1>
        {user.role !== "boss" && (
          <Link
            href="/purchase-orders/new"
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            新建进货单
          </Link>
        )}
      </div>

      <form className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <input
          name="q"
          type="text"
          placeholder="单据号搜索"
          defaultValue={q}
          className="w-40 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
        <select name="supplierId" defaultValue={supplierId ?? ""} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">全部供应商</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status ?? ""} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          {statusOptions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200"
        >
          筛选
        </button>
        <span className="text-xs text-gray-500">共 {total} 张</span>
      </form>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">单据号</th>
              <th className="px-4 py-3 font-medium">供应商</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">金额</th>
              <th className="px-4 py-3 font-medium">已付</th>
              <th className="px-4 py-3 font-medium">来源</th>
              <th className="px-4 py-3 font-medium">操作人</th>
              <th className="px-4 py-3 font-medium">开单时间</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {orders.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                  暂无进货单
                </td>
              </tr>
            )}
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="px-4 py-2.5 font-medium text-gray-900">{o.orderNo}</td>
                <td className="px-4 py-2.5 text-gray-900">{o.supplier.name}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={
                      o.status === "received"
                        ? "rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700"
                        : o.status === "voided"
                          ? "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                          : "rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
                    }
                  >
                    {STATUS_LABELS[o.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-900">¥{Number(o.totalAmount).toFixed(2)}</td>
                <td className="px-4 py-2.5 text-gray-600">¥{Number(o.paidAmount).toFixed(2)}</td>
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
                  <Link href={`/purchase-orders/${o.id}`} className="text-blue-600 hover:underline">
                    详情
                  </Link>
                </td>
              </tr>
            ))}
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
    sp.set("page", String(p));
    return `/purchase-orders?${sp.toString()}`;
  }
}
