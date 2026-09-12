import { redirect } from "next/navigation";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { badgeMuted, badgeOk, segActive, segIdle } from "@/lib/ui";
import { ReturnListActions } from "./return-list-actions";

export const metadata = { title: "销售退货单 - 玮川进销存" };

const STATUS_LABELS: Record<string, string> = { confirmed: "已开单", voided: "已作废" };

export default async function SaleReturnsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const returns = await prisma.saleReturn.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      saleOrder: { select: { orderNo: true } },
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
                <td className="px-4 py-2.5 text-gray-600">{r.saleOrder.orderNo}</td>
                <td className="px-4 py-2.5 text-gray-900">{r.customer.name}</td>
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
    </div>
  );
}
