import { redirect, notFound } from "next/navigation";
import { NoPermission } from "@/components/empty-state";
import { btnSecondary, btnWarn } from "@/lib/ui";
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

/**
 * 进货单详情：标题栏放独立操作按钮，随后是基本信息（含金额）、付款、商品明细与关联信息，
 * 与售卖单详情保持一致的布局。
 */
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
      returns: { orderBy: { createdAt: "desc" } }, // 本单退货记录
    },
  });
  if (!order) notFound();

  // 矩阵：业务员仅能查看自己开的单
  if (user.role === "sales" && order.operatorId !== user.id) {
    return (
      <NoPermission text="无权限查看此单据（业务员仅能查看自己的单）" />
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
  const total = Number(order.totalAmount);
  const paid = Number(order.paidAmount);
  const outstanding = total - paid - returnedSum;

  const showActions = order.status !== "voided" && (canReceive || canVoid || canReturn);

  return (
    <div className="space-y-6">
      {/* 标题与操作：按钮各自独立，集中在右上角 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <div className="flex flex-wrap items-center gap-2">
          {showActions && (
            <DetailActions
              orderId={order.id}
              status={order.status}
              canReceive={canReceive}
              canVoid={canVoid}
            />
          )}
          {canReturn && (
            <Link
              href={`/purchase-returns/new?orderId=${order.id}`}
              className={btnWarn}
            >
              退货
            </Link>
          )}
          <Link
            href="/purchase-orders"
            className={btnSecondary}
          >
            ← 返回列表
          </Link>
        </div>
      </div>

      {/* 基本信息（含金额）：紧凑排列，不分散 */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">基本信息</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          <InfoItem label="供应商" value={order.supplier.name} />
          <InfoItem label="开单操作人" value={order.operator.displayName} />
          <InfoItem label="开单时间" value={order.createdAt.toLocaleString("zh-CN")} />
          <InfoItem label="来源" value={order.sourceType === "auto" ? "自动补货（缺货即时入库）" : "手动进货"} />
          <InfoItem label="入库时间" value={order.receivedAt?.toLocaleString("zh-CN") ?? "—"} />
          <InfoItem label="备注" value={order.remark ?? "—"} />
        </dl>

        <div className="mt-4 flex flex-wrap items-start gap-x-10 gap-y-3 border-t border-gray-100 pt-4">
          <Amount label="已付 / 应付" value={`¥${paid.toFixed(2)} / ¥${total.toFixed(2)}`} />
          <Amount
            label="未付金额"
            value={`¥${Math.max(outstanding, 0).toFixed(2)}`}
            tone={outstanding > 0 ? "red" : "muted"}
          />
        </div>
      </div>

      {/* 付款登记与记录（紧跟基本信息） */}
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

      {/* 商品明细 */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">
          商品明细
          <span className="ml-2 text-xs font-normal text-gray-400">{order.items.length} 行</span>
        </div>
        <table className="min-w-full divide-y divide-gray-200 text-sm [&_td]:align-top [&_th]:whitespace-nowrap">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">编码</th>
              <th className="px-4 py-3 font-medium">商品名称</th>
              <th className="px-4 py-3 font-medium">规格</th>
              <th className="px-4 py-3 font-medium">数量</th>
              <th className="px-4 py-3 font-medium">单位</th>
              <th className="px-4 py-3 font-medium">进价</th>
              <th className="px-4 py-3 text-right font-medium">金额</th>
              <th className="px-4 py-3 font-medium">备注</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {order.items.map((item) => {
              const qty = Number(item.quantity);
              const restock = Number(item.restockQty);
              return (
                <tr key={item.id}>
                  <td className="px-4 py-2.5 text-gray-600">{item.product.code}</td>
                  <td className="px-4 py-2.5 text-gray-900">{item.product.name}</td>
                  <td className="px-4 py-2.5 text-gray-600">{item.product.spec ?? "—"}</td>
                  <td className="px-4 py-2.5 text-gray-900">
                    <div>{qty.toFixed(3)}</div>
                    {restock > 0 && (
                      <div className="text-xs text-blue-600">
                        客户 {(qty - restock).toFixed(3)} + 备货 {restock.toFixed(3)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{item.unit.name}</td>
                  <td className="px-4 py-2.5 text-gray-600">¥{Number(item.unitPrice).toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-900">
                    ¥{Number(item.amount).toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{item.remark ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr>
              <td colSpan={7} className="px-4 py-3 text-right text-sm text-gray-600">
                合计
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                ¥{total.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 本单退货记录 */}
      {order.returns.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm">
          <h2 className="mb-2 font-semibold text-gray-900">本单退货记录</h2>
          <div className="space-y-1.5">
            {order.returns.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 text-gray-700">
                <span className="font-medium text-gray-900">{r.orderNo}</span>
                <span>¥{Number(r.totalAmount).toFixed(2)}</span>
                <span
                  className={
                    r.status === "confirmed"
                      ? "rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700"
                      : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                  }
                >
                  {r.status === "confirmed" ? "已退" : "已作废"}
                </span>
                <Link href="/purchase-returns" className="text-xs text-blue-600 hover:underline">
                  查看退货单
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 作废留痕 */}
      {order.status === "voided" && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
          作废人：{order.voidedBy ?? "—"} ｜ 作废时间：{order.voidedAt?.toLocaleString("zh-CN") ?? "—"} ｜
          原因：{order.voidReason ?? "—"}
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-gray-900">{value}</dd>
    </div>
  );
}

function Amount({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "red" | "green" | "muted";
}) {
  const color =
    tone === "red" ? "text-red-600" : tone === "green" ? "text-green-700" : tone === "muted" ? "text-gray-500" : "text-gray-900";
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
