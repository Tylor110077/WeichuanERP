import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { ReturnListActions } from "./return-list-actions";

export const metadata = { title: "进货退货单 - 维川进销存" };

const STATUS_LABELS: Record<string, string> = { confirmed: "已开单", voided: "已作废" };

export default async function PurchaseReturnsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const returns = await prisma.purchaseReturn.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      purchaseOrder: { select: { orderNo: true } },
      supplier: { select: { name: true } },
      operator: { select: { displayName: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">进货退货单</h1>
        <span className="text-xs text-gray-500">从进货单详情页发起退货</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">退货单号</th>
              <th className="px-4 py-3 font-medium">原进货单</th>
              <th className="px-4 py-3 font-medium">供应商</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">冲减应付</th>
              <th className="px-4 py-3 font-medium">操作人</th>
              <th className="px-4 py-3 font-medium">时间</th>
              {user.role !== "sales" && <th className="px-4 py-3 font-medium">操作</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {returns.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  暂无退货单
                </td>
              </tr>
            )}
            {returns.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5 font-medium text-gray-900">{r.orderNo}</td>
                <td className="px-4 py-2.5 text-gray-600">{r.purchaseOrder.orderNo}</td>
                <td className="px-4 py-2.5 text-gray-900">{r.supplier.name}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={
                      r.status === "confirmed"
                        ? "rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700"
                        : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                    }
                  >
                    {STATUS_LABELS[r.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-900">¥{Number(r.totalAmount).toFixed(2)}</td>
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
