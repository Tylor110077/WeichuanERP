import { redirect } from "next/navigation";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { badgeMuted, badgeOk, segActive, segIdle } from "@/lib/ui";
import { ReturnListActions } from "./return-list-actions";

export const metadata = { title: "销售退货单 - 玮川进销存" };

const STATUS_LABELS: Record<string, string> = { confirmed: "已开单", voided: "已作废" };

/** 单据会一直累积：按页取，不在首屏全量渲染（与售卖单/进货单同一套 PAGE_SIZE 与写法） */
const PAGE_SIZE = 50;

export default async function SaleReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const total = await prisma.saleReturn.count();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // 页码夹在范围内：单据被作废/清理后，别把用户留在一个空的第 N 页
  const page = Math.min(Math.max(1, Number(params.page) || 1), totalPages);

  const returns = await prisma.saleReturn.findMany({
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      // 取 id 是为了让「原售卖单」可点（跳到那张单据详情）
      saleOrder: { select: { id: true, orderNo: true } },
      customer: { select: { name: true } },
      operator: { select: { displayName: true } },
    },
  });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">退货单</h1>
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm">
          <Link href="/sale-returns" className={`px-4 py-1.5 ${segActive}`}>
            销售退货
          </Link>
          <Link href="/purchase-returns" className={`px-4 py-1.5 ${segIdle}`}>
            进货退货
          </Link>
        </div>
      </div>
      {/* 单据一多就长了：封顶滚动，避免页面无限变长（列表本身取最近 200 张） */}
      <p className="text-xs text-gray-500">
        共 {total} 张
        {totalPages > 1 && ` ・ 第 ${page} / ${totalPages} 页`}
      </p>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-3 font-medium">退货单号</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">原售卖单</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">客户</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">状态</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">冲减应收</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">操作人</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">时间</th>
              {user.role !== "sales" && <th className="whitespace-nowrap px-4 py-3 font-medium">操作</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
            {returns.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState title="该条件下没有退货单" />
                </td>
              </tr>
            )}
            {returns.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-4 py-2.5 font-medium text-gray-900">{r.orderNo}</td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/sale-orders/${r.saleOrder.id}`}
                    className="whitespace-nowrap text-blue-600 hover:underline"
                    title="打开这张售卖单"
                  >
                    {r.saleOrder.orderNo}
                  </Link>
                </td>
                <td className="min-w-[5.5rem] px-4 py-2.5 text-gray-900">{r.customer.name}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={
                      r.status === "confirmed"
                        ? badgeOk
                        : badgeMuted
                    }
                  >
                    {STATUS_LABELS[r.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-gray-900 tabular-nums">¥{Number(r.totalAmount).toFixed(2)}</td>
                <td className="px-4 py-2.5 text-gray-600">{r.operator.displayName}</td>
                <td className="px-4 py-2.5 text-gray-600">{r.createdAt.toLocaleString("zh-CN")}</td>
                {user.role !== "sales" && (
                  <td className="px-4 py-2.5">
                    <ReturnListActions id={r.id} status={r.status} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-3 text-sm">
          {page > 1 ? (
            <Link href={`/sale-returns?page=${page - 1}`} className="text-blue-600 hover:underline">上一页</Link>
          ) : (
            <span className="text-gray-400">上一页</span>
          )}
          <span className="text-gray-600">第 {page} / {totalPages} 页</span>
          {page < totalPages ? (
            <Link href={`/sale-returns?page=${page + 1}`} className="text-blue-600 hover:underline">下一页</Link>
          ) : (
            <span className="text-gray-400">下一页</span>
          )}
        </div>
      )}
    </div>
  );
}
