import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { DateShortcuts } from "@/components/date-shortcuts";

export const metadata = { title: "供应商对账 - 玮川进销存" };

const METHOD_LABELS: Record<string, string> = {
  cash: "现金",
  bank: "银行转账",
  wechat: "微信",
  alipay: "支付宝",
  other: "其他",
};

/** 供应商进货对账：按供应商 + 期间 + 收付状态，每单含商品明细与付款记录。 */
export default async function SupplierStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ supplierId?: string; from?: string; to?: string; status?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "sales") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限访问供应商对账（管理员/老板）
      </div>
    );
  }

  const params = await searchParams;
  const supplierId = params.supplierId ? Number(params.supplierId) : undefined;
  const status = params.status || undefined;
  const { gte, lte } = dateRange(params.from, params.to);

  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // 选中的供应商必须是有效选择；未选时展示全部？业务上"某个商家"——默认取第一家
  const effectiveSupplierId = supplierId && suppliers.some((s) => s.id === supplierId)
    ? supplierId
    : suppliers[0]?.id;

  if (!effectiveSupplierId) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold text-gray-900">供应商对账</h1>
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
          请先建立供应商档案
        </div>
      </div>
    );
  }

  const orders = await prisma.purchaseOrder.findMany({
    where: {
      supplierId: effectiveSupplierId,
      status: { not: "voided" },
      createdAt: { gte, lte },
    },
    orderBy: { createdAt: "desc" },
    include: {
      items: { include: { product: { select: { code: true, name: true } }, unit: { select: { name: true } } } },
      returns: { where: { status: "confirmed" } },
      operator: { select: { displayName: true } },
    },
    take: 500,
  });

  const payments = await prisma.payment.findMany({
    where: {
      orderType: "purchase",
      orderId: { in: orders.map((o) => o.id) },
      status: "confirmed",
    },
    orderBy: { createdAt: "asc" },
    include: { operator: { select: { displayName: true } } },
  });
  const paymentsByOrder = new Map<number, typeof payments>();
  for (const p of payments) {
    const arr = paymentsByOrder.get(p.orderId) ?? [];
    arr.push(p);
    paymentsByOrder.set(p.orderId, arr);
  }

  const rows = orders.map((o) => {
    const paid = (paymentsByOrder.get(o.id) ?? []).reduce((s, p) => s + Number(p.amount), 0);
    const returned = o.returns.reduce((s, r) => s + Number(r.totalAmount), 0);
    const unpaid = Math.max(0, Number(o.totalAmount) - paid - returned);
    return { o, paid, returned, unpaid };
  }).filter((r) =>
    status === "unpaid" ? r.unpaid > 0 : status === "paid" ? r.unpaid <= 0 : true
  );

  const totalAmount = rows.reduce((s, r) => s + Number(r.o.totalAmount), 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
  const totalUnpaid = rows.reduce((s, r) => s + r.unpaid, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">供应商对账</h1>
      </div>

      <DateShortcuts basePath="/supplier-statement" extraQuery={{ supplierId: String(effectiveSupplierId), status: status ?? "" }} />

      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <label htmlFor="supplierId" className="block text-xs font-medium text-gray-600">供应商</label>
          <select id="supplierId" name="supplierId" defaultValue={effectiveSupplierId} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="from" className="block text-xs font-medium text-gray-600">开始（默认本月 1 日）</label>
          <input id="from" type="date" name="from" defaultValue={params.from} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label htmlFor="to" className="block text-xs font-medium text-gray-600">结束（默认今天）</label>
          <input id="to" type="date" name="to" defaultValue={params.to} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label htmlFor="status" className="block text-xs font-medium text-gray-600">付款状态</label>
          <select id="status" name="status" defaultValue={status ?? ""} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">全部</option>
            <option value="unpaid">未付清</option>
            <option value="paid">已付清</option>
          </select>
        </div>
        <button type="submit" className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200">
          查询
        </button>
        <span className="text-xs text-gray-500">
          共 {rows.length} 单 ｜ 应付 ¥{totalAmount.toFixed(2)} ｜ 已付 ¥{totalPaid.toFixed(2)} ｜ 未付 ¥{totalUnpaid.toFixed(2)}
        </span>
      </form>

      <div className="space-y-3">
        {rows.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
            该期间无进货单
          </div>
        )}
        {rows.map(({ o, returned, unpaid }) => (
          <details key={o.id} className="rounded-xl border border-gray-200 bg-white">
            <summary className="flex cursor-pointer flex-wrap items-center gap-4 px-4 py-3 text-sm">
              <span className="font-medium text-gray-900">{o.orderNo}</span>
              <span className="text-gray-600">{o.createdAt.toLocaleDateString("zh-CN")}</span>
              <span className="text-gray-900">¥{Number(o.totalAmount).toFixed(2)}</span>
              <span className={unpaid > 0 ? "text-red-600" : "text-green-700"}>
                {unpaid > 0 ? `未付 ¥${unpaid.toFixed(2)}` : "已付清"}
              </span>
              {returned > 0 && <span className="text-orange-600">退货冲减 ¥{returned.toFixed(2)}</span>}
              <span className="text-xs text-gray-400">点击展开商品明细 & 付款记录</span>
            </summary>
            <div className="border-t border-gray-100 px-4 py-3">
              <table className="w-full max-w-xl text-sm">
                <thead className="text-left text-xs text-gray-500">
                  <tr>
                    <th className="py-1 font-medium">商品</th>
                    <th className="py-1 text-right font-medium">数量</th>
                    <th className="py-1 text-right font-medium">进价</th>
                    <th className="py-1 text-right font-medium">金额</th>
                  </tr>
                </thead>
                <tbody>
                  {o.items.map((it) => (
                    <tr key={it.id} className="text-gray-900">
                      <td className="py-1">{it.product.code} {it.product.name}</td>
                      <td className="py-1 text-right">{Number(it.quantity).toFixed(3)} {it.unit.name}</td>
                      <td className="py-1 text-right">¥{Number(it.unitPrice).toFixed(2)}</td>
                      <td className="py-1 text-right">¥{Number(it.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 space-y-1">
                {o.returns.length > 0 && (
                  <p className="text-xs text-orange-600">退货：{o.returns.map((r) => `${r.orderNo}（¥${Number(r.totalAmount).toFixed(2)}）`).join("、")}</p>
                )}
                {(paymentsByOrder.get(o.id) ?? []).length === 0 ? (
                  <p className="text-xs text-gray-400">暂无付款记录</p>
                ) : (
                  <p className="text-xs text-gray-600">
                    付款：{(paymentsByOrder.get(o.id) ?? []).map((p) => `${p.orderNo} ¥${Number(p.amount).toFixed(2)} ${METHOD_LABELS[p.method] ?? p.method}（${p.operator.displayName} 于 ${p.createdAt.toLocaleString("zh-CN")}）`).join("；")}
                  </p>
                )}
              </div>
              <Link href={`/purchase-orders/${o.id}`} className="mt-2 inline-block text-xs text-blue-600 hover:underline">
                查看单据详情 →
              </Link>
            </div>
          </details>
        ))}
      </div>
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
