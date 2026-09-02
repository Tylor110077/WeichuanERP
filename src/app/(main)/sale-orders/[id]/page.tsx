import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { DetailActions } from "./detail-actions";
import { ReceiptBlock } from "./receipt-block";

export const metadata = { title: "售卖单详情 - 玮川进销存" };

const STATUS_LABELS: Record<string, string> = {
  confirmed: "已开单",
  voided: "已作废",
};

export default async function SaleOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isInteger(id)) notFound();

  const order = await prisma.saleOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      operator: true,
      items: { include: { product: true, unit: true } },
      autoRestockOrders: { include: { supplier: { select: { name: true } } } },
    },
  });
  if (!order) notFound();

  if (user.role === "sales" && order.operatorId !== user.id) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限查看此单据（业务员仅能查看自己的单）
      </div>
    );
  }

  const canVoid = user.role === "admin" || user.role === "boss";
  // 矩阵：成本/毛利仅管理员/老板可见
  const canSeeCost = user.role !== "sales";
  const canCollect = user.role === "admin" || user.role === "boss"; // 矩阵：收款登记

  const [payments, returns] = await Promise.all([
    prisma.payment.findMany({
      where: { orderType: "sale", orderId: order.id },
      orderBy: { createdAt: "desc" },
      include: { operator: { select: { displayName: true } } },
    }),
    prisma.saleReturn.findMany({
      where: { saleOrderId: order.id, status: "confirmed" },
      select: { totalAmount: true },
    }),
  ]);
  const returnedSum = returns.reduce((s, r) => s + Number(r.totalAmount), 0);
  const outstanding =
    Number(order.totalAmount) - Number(order.receivedAmount) - returnedSum;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">
          售卖单 {order.orderNo}
          <span
            className={
              order.status === "confirmed"
                ? "ml-3 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700"
                : "ml-3 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
            }
          >
            {STATUS_LABELS[order.status]}
          </span>
        </h1>
        <Link href="/sale-orders" className="text-sm text-blue-600 hover:underline">
          ← 返回列表
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="客户" value={order.customer.name} />
        <InfoCard label="开单操作人" value={order.operator.displayName} />
        <InfoCard label="开单时间" value={order.createdAt.toLocaleString("zh-CN")} />
        <InfoCard label="应收金额" value={`¥${Number(order.totalAmount).toFixed(2)}`} />
        <InfoCard label="已收金额" value={`¥${Number(order.receivedAmount).toFixed(2)}`} />
        <InfoCard
          label="未收金额"
          value={`¥${Math.max(
            Number(order.totalAmount) - Number(order.receivedAmount) - returnedSum,
            0
          ).toFixed(2)}`}
          highlight={Number(order.totalAmount) - Number(order.receivedAmount) - returnedSum > 0}
        />
        <InfoCard
          label="本单毛利（按成本快照）"
          value={canSeeCost ? `¥${(Number(order.totalAmount) - costSum(order)).toFixed(2)}` : "仅管理员/老板可见"}
        />
        <InfoCard label="关联自动补货单" value={order.autoRestockOrders.length > 0 ? `${order.autoRestockOrders.length} 张` : "无"} />
        <InfoCard label="备注" value={order.remark ?? "—"} />
      </div>

      {order.autoRestockOrders.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">自动补货进货单（缺货即时入库）</h2>
          <div className="space-y-1 text-sm">
            {order.autoRestockOrders.map((po) => (
              <div key={po.id} className="flex items-center gap-3">
                <Link href={`/purchase-orders/${po.id}`} className="text-blue-600 hover:underline">
                  {po.orderNo}
                </Link>
                <span className="text-gray-600">{po.supplier.name}</span>
                <span
                  className={
                    po.status === "received"
                      ? "rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700"
                      : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                  }
                >
                  {po.status === "received" ? "已入库" : "已作废"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">编码</th>
              <th className="px-4 py-3 font-medium">商品名称</th>
              <th className="px-4 py-3 font-medium">数量</th>
              <th className="px-4 py-3 font-medium">单位</th>
              <th className="px-4 py-3 font-medium">售价</th>
              <th className="px-4 py-3 text-right font-medium">金额</th>
              {canSeeCost && <th className="px-4 py-3 text-right font-medium">成本（快照）</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {order.items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-2.5 text-gray-600">{item.product.code}</td>
                <td className="px-4 py-2.5 text-gray-900">{item.product.name}</td>
                <td className="px-4 py-2.5 text-gray-900">{Number(item.quantity).toFixed(3)}</td>
                <td className="px-4 py-2.5 text-gray-600">{item.unit.name}</td>
                <td className="px-4 py-2.5 text-gray-600">¥{Number(item.unitPrice).toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right text-gray-900">¥{Number(item.amount).toFixed(2)}</td>
                {canSeeCost && (
                  <td className="px-4 py-2.5 text-right text-gray-600">
                    ¥{Number(item.costAmount).toFixed(2)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">单据操作</h2>
        <div className="flex flex-wrap items-center gap-3">
          {canVoid && <DetailActions orderId={order.id} status={order.status} />}
          {!canVoid && order.status === "confirmed" && (
            <span className="text-xs text-gray-400">业务员无作废权限（管理员/老板可作废）</span>
          )}
          {order.status === "confirmed" && (
            <Link
              href={`/sale-returns/new?orderId=${order.id}`}
              className="rounded-md border border-orange-300 px-4 py-1.5 text-sm font-medium text-orange-600 hover:bg-orange-50"
            >
              退货（按原单部分退货）
            </Link>
          )}
        </div>
      </div>

      {order.status === "voided" && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
          作废人：{order.voidedBy ?? "—"} ｜ 作废时间：{order.voidedAt?.toLocaleString("zh-CN") ?? "—"} ｜
          原因：{order.voidReason ?? "—"}
        </div>
      )}

      <ReceiptBlock
        orderId={order.id}
        orderStatus={order.status}
        outstanding={outstanding}
        canPay={canCollect}
        payments={payments.map((p) => ({
          id: p.id,
          orderNo: p.orderNo,
          amount: Number(p.amount),
          method: p.method,
          createdAt: p.createdAt.toLocaleString("zh-CN"),
          operatorName: p.operator.displayName,
          status: p.status,
        }))}
      />
    </div>
  );
}

function costSum(order: {
  items: { costAmount: unknown }[];
}): number {
  return order.items.reduce((s, it) => s + Number(it.costAmount), 0);
}

function InfoCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-4 ${highlight ? "bg-red-50/40" : ""}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-sm font-medium ${highlight ? "text-red-600" : "text-gray-900"}`}>{value}</div>
    </div>
  );
}
