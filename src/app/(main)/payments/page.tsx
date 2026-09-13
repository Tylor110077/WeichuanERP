import { redirect } from "next/navigation";
import Link from "next/link";
import { NoPermission } from "@/components/empty-state";
import { badgeDanger, badgeMuted, badgeOk, btnSecondary, inputBase } from "@/lib/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { pinyinQuery } from "@/lib/pinyin";
import { dateRange } from "@/lib/reports";
import { DateShortcuts } from "@/components/date-shortcuts";
import { FilterForm } from "@/components/filter-form";
import { SearchInput } from "@/components/search-input";
import { PAYMENT_DIRECTION_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/payment-labels";

export const metadata = { title: "财务流水 - 玮川进销存" };

const PAGE_SIZE = 30;

/**
 * 财务流水：把钱的两条腿放在一页里看——收客户的款、付厂家的款。
 *
 * 数据就是收付款登记写的那张表（payments），与单据详情、厂家对账里的收付款记录
 * 是同一批数据，不另存一份；每笔都能点回它所属的单据。
 * 作废的收付款默认不显示（用状态筛选可以翻出来）。
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; from?: string; to?: string; direction?: string; status?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "sales") {
    return <NoPermission text="无权限查看财务流水（管理员/老板）" />;
  }

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const direction: "receipt" | "payment" | undefined =
    params.direction === "receipt" || params.direction === "payment" ? params.direction : undefined;
  /** 默认只看已登记；作废的要显式选出来（财务口径上作废不算数） */
  const status = params.status === "all" ? undefined : params.status === "voided" ? "voided" : "confirmed";
  const q = params.q?.trim();
  const range = dateRange(params.from, params.to);

  // 关键词：收付款单号 / 备注 / 单据号 / 客户名（含拼音）/ 厂家名（含拼音）
  let qWhere = {};
  if (q) {
    const [sales, purchases] = await Promise.all([
      prisma.saleOrder.findMany({
        where: {
          OR: [
            { orderNo: { contains: q } },
            { customer: { name: { contains: q } } },
            { customer: { searchPinyin: { contains: pinyinQuery(q) } } },
          ],
        },
        select: { id: true },
        take: 500,
      }),
      prisma.purchaseOrder.findMany({
        where: {
          OR: [
            { orderNo: { contains: q } },
            { supplier: { name: { contains: q } } },
            { supplier: { searchPinyin: { contains: pinyinQuery(q) } } },
          ],
        },
        select: { id: true },
        take: 500,
      }),
    ]);
    qWhere = {
      OR: [
        { orderNo: { contains: q } },
        { remark: { contains: q } },
        { orderType: "sale" as const, orderId: { in: sales.map((s) => s.id) } },
        { orderType: "purchase" as const, orderId: { in: purchases.map((p) => p.id) } },
      ],
    };
  }

  /** 合计与列表共用这份筛选（合计不分收/付，两边的钱都要看） */
  const baseWhere = {
    ...(status ? { status: status as "confirmed" | "voided" } : {}),
    ...qWhere,
    createdAt: { gte: range.gte, lte: range.lte },
  };
  const listWhere = { ...baseWhere, ...(direction ? { direction } : {}) };

  const [total, payments, sums] = await Promise.all([
    prisma.payment.count({ where: listWhere }),
    prisma.payment.findMany({
      where: listWhere,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { operator: { select: { displayName: true } } },
    }),
    prisma.payment.groupBy({ by: ["direction"], where: baseWhere, _sum: { amount: true } }),
  ]);

  // 对方（客户 / 厂家）与关联单据号：按单据类型分别查一次
  const saleIds = payments.filter((p) => p.orderType === "sale").map((p) => p.orderId);
  const purchaseIds = payments.filter((p) => p.orderType === "purchase").map((p) => p.orderId);
  const [sales, purchases] = await Promise.all([
    saleIds.length > 0
      ? prisma.saleOrder.findMany({
          where: { id: { in: saleIds } },
          select: { id: true, orderNo: true, customer: { select: { name: true } } },
        })
      : Promise.resolve([]),
    purchaseIds.length > 0
      ? prisma.purchaseOrder.findMany({
          where: { id: { in: purchaseIds } },
          select: { id: true, orderNo: true, supplier: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);
  const saleMap = new Map(sales.map((s) => [s.id, s]));
  const purchaseMap = new Map(purchases.map((p) => [p.id, p]));

  const received = Number(sums.find((s) => s.direction === "receipt")?._sum.amount ?? 0);
  const paid = Number(sums.find((s) => s.direction === "payment")?._sum.amount ?? 0);
  const net = received - paid;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const buildHref = (target: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, page: String(target) })) {
      if (v) sp.set(k, v);
    }
    return `/payments?${sp.toString()}`;
  };

  const stat = (label: string, value: string, tone = "text-gray-900") => (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">财务流水</h1>
        <Link href="/receivables-payables" className={btnSecondary}>
          去应收应付登记收付款 →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stat("收款合计（来自客户）", `¥${received.toFixed(2)}`, "text-green-700")}
        {stat("付款合计（付给厂家）", `¥${paid.toFixed(2)}`, "text-red-600")}
        {stat("净流入（收 − 付）", `¥${net.toFixed(2)}`, net >= 0 ? "text-gray-900" : "text-red-600")}
      </div>

      <DateShortcuts
        basePath="/payments"
        extraQuery={{ direction: direction ?? "", status: params.status ?? "", q: q ?? "" }}
      />

      <FilterForm className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <SearchInput
          name="q"
          type="text"
          placeholder="单号 / 客户 / 厂家 / 备注"
          defaultValue={q}
          className={`${inputBase} w-52`}
        />
        <input type="date" name="from" defaultValue={params.from} className={`${inputBase}`} />
        <input type="date" name="to" defaultValue={params.to} className={`${inputBase}`} />
        <select name="direction" defaultValue={direction ?? ""} className={`${inputBase}`}>
          <option value="">收款 + 付款</option>
          <option value="receipt">只看收款</option>
          <option value="payment">只看付款</option>
        </select>
        <select name="status" defaultValue={params.status ?? ""} className={`${inputBase}`}>
          <option value="">已登记</option>
          <option value="voided">只看已作废</option>
          <option value="all">全部（含作废）</option>
        </select>
        <button type="submit" className={btnSecondary}>
          筛选
        </button>
        <span className="text-xs text-gray-500">共 {total} 笔</span>
      </FilterForm>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[64rem] divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-3 font-medium">时间</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">收付</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">关联单据</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">对方</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">方式</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">金额</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">单号</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">备注</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">登记人</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
            {payments.length === 0 && (
              <tr>
                <td colSpan={10}>
                  <p className="rounded-lg px-3 py-10 text-center text-sm text-gray-400">
                    这段时间没有收付款记录。到「应收应付」里点单据的「详情 / 登记」即可登记收款或付款。
                  </p>
                </td>
              </tr>
            )}
            {payments.map((p) => {
              const isReceipt = p.direction === "receipt";
              const isSale = p.orderType === "sale";
              const order = isSale ? saleMap.get(p.orderId) : purchaseMap.get(p.orderId);
              const partner = isSale
                ? (order as { customer?: { name: string } } | undefined)?.customer?.name
                : (order as { supplier?: { name: string } } | undefined)?.supplier?.name;
              const orderHref = isSale
                ? `/sale-orders/${p.orderId}#receipt`
                : `/purchase-orders/${p.orderId}#payment`;
              return (
                <tr key={p.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                    {p.createdAt.toLocaleString("zh-CN")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className={isReceipt ? badgeOk : badgeMuted}>
                      {PAYMENT_DIRECTION_LABELS[p.direction]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Link href={orderHref} className="text-blue-600 hover:underline">
                      {order?.orderNo ?? "—"}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-900">{partner ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                    {PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-2.5 font-medium tabular-nums ${
                      isReceipt ? "text-green-700" : "text-red-600"
                    }`}
                  >
                    {isReceipt ? "+" : "−"}¥{Number(p.amount).toFixed(2)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-500">{p.orderNo}</td>
                  <td className="px-4 py-2.5 text-gray-500">{p.remark || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{p.operator.displayName}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {p.status === "voided" ? (
                      <span className={badgeDanger}>{PAYMENT_STATUS_LABELS.voided}</span>
                    ) : (
                      <span className={badgeOk}>{PAYMENT_STATUS_LABELS.confirmed}</span>
                    )}
                  </td>
                </tr>
              );
            })}
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
}
