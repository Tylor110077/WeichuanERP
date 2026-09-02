import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { DetailActions } from "./detail-actions";
import { PaymentBlock } from "./payment-block";

export const metadata = { title: "进货单详情 - 玮川进销存" };

const STATUS_LABELS: Record<string, string> = {
  pending: "待收货",
  received: "已入库",
  voided: "已作废",
};

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isInteger(id)) notFound();

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      operator: true,
      items: { include: { product: true, unit: true } },
    },
  });
  if (!order) notFound();

  // 矩阵：业务员仅能查看自己开的单
  if (user.role === "sales" && order.operatorId !== user.id) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限查看此单据（业务员仅能查看自己的单）
      </div>
    );
  }

  const canReceive = user.role !== "boss" && (user.role === "admin" || order.operatorId === user.id);
  const canVoid = user.role === "admin" || user.role === "boss";
  const canReturn = user.role !== "boss" && order.status === "received";
  const canPay = user.role === "admin" || user.role === "boss"; // 矩阵：付款登记

  // 付款记录与未付金额（未付 = 应付 − 已付 − 未作废退货冲减）
  const [payments, returns] = await Promise.all([
    prisma.payment.findMany({
      where: { orderType: "purchase", orderId: order.id },
      orderBy: { createdAt: "desc" },
      include: { operator: { select: { displayName: true } } },
    }),
    prisma.purchaseReturn.findMany({
      where: { purchaseOrderId: order.id, status: "confirmed" },
      select: { totalAmount: true },
    }),
  ]);
  const returnedSum = returns.reduce((s, r) => s + Number(r.totalAmount), 0);
  const outstanding =
    Number(order.totalAmount) - Number(order.paidAmount) - returnedSum;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">
          进货单 {order.orderNo}
          <span
            className={
              order.status === "received"
                ? "ml-3 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700"
                : order.status === "voided"
                  ? "ml-3 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                  : "ml-3 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
            }
          >
            {STATUS_LABELS[order.status]}
          </span>
        </h1>
        <Link href="/purchase-orders" className="text-sm text-blue-600 hover:underline">
          ← 返回列表
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="供应商" value={order.supplier.name} />
        <InfoCard label="开单操作人" value={order.operator.displayName} />
        <InfoCard label="开单时间" value={order.createdAt.toLocaleString("zh-CN")} />
        <InfoCard label="应付金额" value={`¥${Number(order.totalAmount).toFixed(2)}`} />
        <InfoCard label="已付金额" value={`¥${Number(order.paidAmount).toFixed(2)}`} />
        <InfoCard label="来源" value={order.sourceType === "auto" ? "自动补货" : "手动进货"} />
        <InfoCard label="入库时间" value={order.receivedAt?.toLocaleString("zh-CN") ?? "—"} />
        <InfoCard label="备注" value={order.remark ?? "—"} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">编码</th>
              <th className="px-4 py-3 font-medium">商品名称</th>
              <th className="px-4 py-3 font-medium">规格</th>
              <th className="px-4 py-3 font-medium">数量</th>
              <th className="px-4 py-3 font-medium">单位</th>
              <th className="px-4 py-3 font-medium">进价</th>
              <th className="px-4 py-3 text-right font-medium">金额</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {order.items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-2.5 text-gray-600">{item.product.code}</td>
                <td className="px-4 py-2.5 text-gray-900">{item.product.name}</td>
                <td className="px-4 py-2.5 text-gray-600">{item.product.spec ?? "—"}</td>
                <td className="px-4 py-2.5 text-gray-900">{Number(item.quantity).toFixed(3)}</td>
                <td className="px-4 py-2.5 text-gray-600">{item.unit.name}</td>
                <td className="px-4 py-2.5 text-gray-600">¥{Number(item.unitPrice).toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right text-gray-900">
                  ¥{Number(item.amount).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr>
              <td colSpan={6} className="px-4 py-3 text-right text-sm text-gray-600">
                合计
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                ¥{Number(order.totalAmount).toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {order.status !== "voided" && (canReceive || canVoid || canReturn) && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">单据操作</h2>
          <div className="flex flex-wrap items-center gap-3">
            <DetailActions
              orderId={order.id}
              status={order.status}
              canReceive={canReceive}
              canVoid={canVoid}
            />
            {canReturn && (
              <Link
                href={`/purchase-returns/new?orderId=${order.id}`}
                className="rounded-md bg-orange-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-orange-600"
              >
                退货（按原单部分退货）
              </Link>
            )}
          </div>
        </div>
      )}

      <PaymentBlock
        orderId={order.id}
        orderStatus={order.status}
        outstanding={outstanding}
        canPay={canPay}
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

      {order.status === "voided" && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
          作废人：{order.voidedBy ?? "—"} ｜ 作废时间：{order.voidedAt?.toLocaleString("zh-CN") ?? "—"} ｜
          原因：{order.voidReason ?? "—"}
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-gray-900">{value}</div>
    </div>
  );
}
