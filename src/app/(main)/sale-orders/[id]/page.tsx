import { redirect, notFound } from "next/navigation";
import { NoPermission } from "@/components/empty-state";
import { badgeMuted, badgeOk, btnSecondary, btnWarn } from "@/lib/ui";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { DetailActions } from "./detail-actions";
import { PaymentBlock } from "@/components/payment-block";
import { StarToggle } from "@/components/star-toggle";
import { toggleSaleOrderStarAction } from "../actions";

export const metadata = { title: "售卖单详情 - 玮川进销存" };

const STATUS_LABELS: Record<string, string> = {
  confirmed: "已开单",
  voided: "已作废",
};

/**
 * 售卖单详情：标题栏放独立操作按钮，随后是基本信息（含金额）、收付款、商品明细与关联信息，
 * 相关数据集中不分散。
 */
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
      autoRestockOrders: {
        include: {
          supplier: { select: { name: true } },
          // 光有单号看不出补了什么，把商品行一起带出来
          items: { include: { product: { select: { code: true, name: true } }, unit: { select: { name: true } } } },
        },
      },
      // 本单退货记录：连明细一起取，详情页要写清"退了哪些商品、退了多少"
      returns: {
        orderBy: { createdAt: "desc" },
        include: {
          operator: { select: { displayName: true } },
          items: {
            include: {
              product: { select: { code: true, name: true } },
              unit: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!order) notFound();

  if (user.role === "sales" && order.operatorId !== user.id) {
    return (
      <NoPermission text="无权限查看此单据（业务员仅能查看自己的单）" />
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
  const total = Number(order.totalAmount);
  const received = Number(order.receivedAmount);
  const outstanding = total - received - returnedSum;
  const profit = total - costSum(order);

  return (
    <div className="space-y-6">
      {/* 标题与操作：按钮各自独立，集中在右上角 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-gray-900">
          售卖单 {order.orderNo}
          {/* 星标：开单后也能在这里加/取消（列表里也能点） */}
          <StarToggle id={order.id} starred={order.starred} toggle={toggleSaleOrderStarAction} className="text-lg" />
          <span
            className={
              order.status === "confirmed"
                ? badgeOk
                : badgeMuted
            }
          >
            {STATUS_LABELS[order.status]}
          </span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/sale-orders/${order.id}/print`}
            target="_blank"
            rel="noopener"
            className={btnSecondary}
          >
            打印销售单
          </a>
          {order.status === "confirmed" && (
            <Link
              href={`/sale-returns/new?orderId=${order.id}`}
              className={btnWarn}
            >
              退货
            </Link>
          )}
          <Link
            href="/sale-orders"
            className={btnSecondary}
          >
            ← 返回列表
          </Link>
          {/* 放在最后：作废的操作提示独占一行，排中间会把返回链接挤到提示下面 */}
          {canVoid && <DetailActions orderId={order.id} status={order.status} />}
        </div>
      </div>

      {/* 基本信息（含金额与毛利）：紧凑排列，不分散 */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">基本信息</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          <InfoItem label="客户" value={order.customer.name} />
          <InfoItem label="开单操作人" value={order.operator.displayName} />
          <InfoItem label="开单时间" value={order.createdAt.toLocaleString("zh-CN")} />
          <InfoItem label="备注" value={order.remark ?? "—"} />
        </dl>

        <div className="mt-4 flex flex-wrap items-start gap-x-10 gap-y-3 border-t border-gray-100 pt-4">
          <Amount label="已收 / 应收" value={`¥${received.toFixed(2)} / ¥${total.toFixed(2)}`} />
          <Amount
            label="未收金额"
            value={`¥${Math.max(outstanding, 0).toFixed(2)}`}
            tone={outstanding > 0 ? "red" : "muted"}
          />
          {canSeeCost && (
            <Amount
              label="本单毛利（按成本快照）"
              value={`¥${profit.toFixed(2)}`}
              tone={profit >= 0 ? "green" : "red"}
            />
          )}
        </div>
      </div>

      {/* 收款登记与记录（紧跟基本信息） */}
      <PaymentBlock
        direction="receipt"
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

      {/* 商品明细 */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">
          商品明细
          <span className="ml-2 text-xs font-normal text-gray-400">{order.items.length} 行</span>
        </div>
        <table className="min-w-full divide-y divide-gray-200 text-sm [&_td]:align-top [&_th]:whitespace-nowrap">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-3 font-medium">编码</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">商品名称</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">数量</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">单位</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">售价</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">金额</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">备注</th>
              {canSeeCost && <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">成本（快照）</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
            {order.items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-2.5 text-gray-600">{item.product.code}</td>
                <td className="px-4 py-2.5 text-gray-900">{item.product.name}</td>
                <td className="px-4 py-2.5 text-gray-900">
                  <div>{Number(item.quantity).toFixed(3)}</div>
                  {(() => {
                    const used = Number(item.stockQtyUsed);
                    const qty = Number(item.quantity);
                    if (used <= 0) return <div className="text-xs text-blue-600">全部现场进货</div>;
                    if (used < qty)
                      return (
                        <div className="text-xs text-gray-500">
                          用库存 {used.toFixed(3)} + 现场进 {(qty - used).toFixed(3)}
                        </div>
                      );
                    return null;
                  })()}
                </td>
                <td className="px-4 py-2.5 text-gray-600">{item.unit.name}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-gray-600 tabular-nums">¥{Number(item.unitPrice).toFixed(2)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-gray-900 tabular-nums">¥{Number(item.amount).toFixed(2)}</td>
                <td className="px-4 py-2.5 text-gray-600">{item.remark ?? "—"}</td>
                {canSeeCost && (
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600 tabular-nums">
                    ¥{Number(item.costAmount).toFixed(2)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 关联单据：自动补货进货单 */}
      {order.autoRestockOrders.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">自动补货进货单（缺货即时入库）</h2>
          <div className="space-y-1.5 text-sm">
            {order.autoRestockOrders.map((po) => (
              <div key={po.id} className="border-b border-gray-50 pb-1.5 last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={`/purchase-orders/${po.id}`} className="text-blue-600 hover:underline">
                    {po.orderNo}
                  </Link>
                  <span className="text-gray-600">{po.supplier.name}</span>
                  <span
                    className={
                      po.status === "received"
                        ? badgeOk
                        : badgeMuted
                    }
                  >
                    {po.status === "received" ? "已入库" : "已作废"}
                  </span>
                </div>
                {/* 具体补了哪些商品：只给单号看不出内容 */}
                <div className="mt-0.5 text-xs text-gray-500">
                  {po.items.length > 0
                    ? po.items
                        .map(
                          (it) =>
                            `${it.product.code} ${it.product.name} ×${Number(it.quantity).toFixed(3)} ${it.unit.name}`
                        )
                        .join("、")
                    : "（无商品行）"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 本单退货记录：写清每次退货退了哪些商品、多少、什么价，而不是只给一个金额 */}
      {order.returns.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm">
          <h2 className="mb-3 font-semibold text-gray-900">
            本单退货记录
            <span className="ml-2 text-xs font-normal text-gray-400">
              共 {order.returns.length} 次 ・ 合计退 ¥{returnedSum.toFixed(2)}
            </span>
          </h2>
          <div className="space-y-4">
            {order.returns.map((r) => (
              <div key={r.id} className="rounded-lg border border-gray-100">
                <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-3 py-2 text-gray-700">
                  <span className="font-medium text-gray-900">{r.orderNo}</span>
                  <span className={r.status === "confirmed" ? badgeOk : badgeMuted}>
                    {r.status === "confirmed" ? "已退" : "已作废"}
                  </span>
                  <span className="text-xs text-gray-500">{r.createdAt.toLocaleString("zh-CN")}</span>
                  <span className="text-xs text-gray-500">经办：{r.operator.displayName}</span>
                  <span className="ml-auto font-medium text-gray-900">
                    退 ¥{Number(r.totalAmount).toFixed(2)}
                  </span>
                </div>
                {r.status !== "confirmed" && r.voidReason && (
                  <p className="px-3 pt-2 text-xs text-gray-500">作废原因：{r.voidReason}</p>
                )}
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500">
                    <tr>
                      <th className="w-28 px-3 py-1.5 font-medium">编码</th>
                      <th className="px-3 py-1.5 font-medium">品名</th>
                      <th className="w-16 px-3 py-1.5 font-medium">单位</th>
                      <th className="w-28 px-3 py-1.5 font-medium">退货数量</th>
                      <th className="w-28 px-3 py-1.5 font-medium">退货价</th>
                      <th className="w-32 px-3 py-1.5 font-medium">金额</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-800">
                    {r.items.map((it) => (
                      <tr key={it.id} className="border-t border-gray-50">
                        <td className="px-3 py-1.5 text-gray-600">{it.product.code}</td>
                        <td className="px-3 py-1.5">{it.product.name}</td>
                        <td className="px-3 py-1.5 text-gray-600">{it.unit.name}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{Number(it.quantity).toFixed(3)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">¥{Number(it.unitPrice).toFixed(2)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">¥{Number(it.amount).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

function costSum(order: {
  items: { costAmount: unknown }[];
}): number {
  return order.items.reduce((s, it) => s + Number(it.costAmount), 0);
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
