import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { PaymentForm } from "./payment-form";
import { VoidPaymentButton } from "./void-payment-button";

export const metadata = { title: "应收应付 - 维川进销存" };

const METHOD_LABELS: Record<string, string> = {
  cash: "现金",
  bank: "银行转账",
  wechat: "微信",
  alipay: "支付宝",
  other: "其他",
};

export default async function ReceivablesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "sales") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限访问应收应付（管理员/老板）
      </div>
    );
  }

  const [saleOrders, purchaseOrders, payments] = await Promise.all([
    prisma.saleOrder.findMany({
      where: { status: "confirmed" },
      include: {
        customer: { select: { name: true } },
        returns: { where: { status: "confirmed" } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.purchaseOrder.findMany({
      where: { status: { in: ["pending", "received"] } },
      include: {
        supplier: { select: { name: true } },
        returns: { where: { status: "confirmed" } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.payment.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { operator: { select: { displayName: true } } },
    }),
  ]);

  // 应收按客户、应付按供应商聚合
  const receivablesByCustomer = new Map<number, { name: string; total: number }>();
  for (const o of saleOrders) {
    const returned = o.returns.reduce((s, r) => s + Number(r.totalAmount), 0);
    const outstanding = Number(o.totalAmount) - Number(o.receivedAmount) - returned;
    const cur = receivablesByCustomer.get(o.customerId) ?? { name: o.customer.name, total: 0 };
    cur.total += outstanding;
    receivablesByCustomer.set(o.customerId, cur);
  }
  const payablesBySupplier = new Map<number, { name: string; total: number }>();
  for (const o of purchaseOrders) {
    const returned = o.returns.reduce((s, r) => s + Number(r.totalAmount), 0);
    const outstanding = Number(o.totalAmount) - Number(o.paidAmount) - returned;
    const cur = payablesBySupplier.get(o.supplierId) ?? { name: o.supplier.name, total: 0 };
    cur.total += outstanding;
    payablesBySupplier.set(o.supplierId, cur);
  }

  const sales = saleOrders
    .map((o) => {
      const returned = o.returns.reduce((s, r) => s + Number(r.totalAmount), 0);
      return {
        id: o.id,
        orderNo: o.orderNo,
        customerName: o.customer.name,
        outstanding: Math.max(0, Number(o.totalAmount) - Number(o.receivedAmount) - returned),
      };
    })
    .filter((o) => o.outstanding > 0);
  const purchases = purchaseOrders
    .map((o) => {
      const returned = o.returns.reduce((s, r) => s + Number(r.totalAmount), 0);
      return {
        id: o.id,
        orderNo: o.orderNo,
        supplierName: o.supplier.name,
        outstanding: Math.max(0, Number(o.totalAmount) - Number(o.paidAmount) - returned),
      };
    })
    .filter((o) => o.outstanding > 0);

  const paymentContext = new Map<number, { orderNo: string; counterName: string }>();
  for (const o of saleOrders) {
    paymentContext.set(o.id, { orderNo: o.orderNo, counterName: o.customer.name });
  }
  for (const o of purchaseOrders) {
    paymentContext.set(o.id, { orderNo: o.orderNo, counterName: o.supplier.name });
  }

  const totalReceivable = [...receivablesByCustomer.values()].reduce((s, v) => s + Math.max(v.total, 0), 0);
  const totalPayable = [...payablesBySupplier.values()].reduce((s, v) => s + Math.max(v.total, 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">应收应付</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="text-sm text-gray-500">客户应收合计（未收）</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">¥{totalReceivable.toFixed(2)}</div>
          <div className="mt-2 space-y-1">
            {[...receivablesByCustomer.entries()]
              .filter(([, v]) => v.total > 0)
              .map(([id, v]) => (
                <div key={id} className="flex justify-between text-sm">
                  <span className="text-gray-700">{v.name}</span>
                  <span className="text-gray-900">¥{v.total.toFixed(2)}</span>
                </div>
              ))}
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="text-sm text-gray-500">供应商应付合计（未付）</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">¥{totalPayable.toFixed(2)}</div>
          <div className="mt-2 space-y-1">
            {[...payablesBySupplier.entries()]
              .filter(([, v]) => v.total > 0)
              .map(([id, v]) => (
                <div key={id} className="flex justify-between text-sm">
                  <span className="text-gray-700">{v.name}</span>
                  <span className="text-gray-900">¥{v.total.toFixed(2)}</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      <PaymentForm saleOrders={sales} purchaseOrders={purchases} />

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">时间</th>
              <th className="px-4 py-3 font-medium">收付单号</th>
              <th className="px-4 py-3 font-medium">方向</th>
              <th className="px-4 py-3 font-medium">对方</th>
              <th className="px-4 py-3 font-medium">关联单据</th>
              <th className="px-4 py-3 font-medium">方式</th>
              <th className="px-4 py-3 text-right font-medium">金额</th>
              <th className="px-4 py-3 font-medium">操作人</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {payments.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                  暂无收付款记录
                </td>
              </tr>
            )}
            {payments.map((p) => {
              const ctx = paymentContext.get(p.orderId);
              return (
                <tr key={p.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                    {p.createdAt.toLocaleString("zh-CN")}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{p.orderNo}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        p.direction === "receipt"
                          ? "rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700"
                          : "rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-700"
                      }
                    >
                      {p.direction === "receipt" ? "收款" : "付款"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-900">{ctx?.counterName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-gray-600">{ctx?.orderNo ?? String(p.orderId)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{METHOD_LABELS[p.method] ?? p.method}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                    ¥{Number(p.amount).toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{p.operator.displayName}</td>
                  <td className="px-4 py-2.5">
                    {p.status === "confirmed" ? (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">已登记</span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">已作废</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <VoidPaymentButton id={p.id} status={p.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
