import { redirect } from "next/navigation";
import { EmptyState, NoPermission } from "@/components/empty-state";
import { badgeMuted, btnSecondary, inputBase } from "@/lib/ui";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { buildCustomerProfile } from "@/lib/customer-profile";
import { DateShortcuts } from "@/components/date-shortcuts";
import { RelatedLinks } from "@/components/related-links";

export const metadata = { title: "客户画像 - 玮川进销存" };

/**
 * 客户画像：按客户统计单数/销售额/成本/利润/平均利润率；
 * 选中客户后列出其每一张售卖单，并展开各单的具体商品明细。
 * 口径：非作废售卖单；成本按单据成本快照（毛利 = 销售额 − 成本快照）。
 */
export default async function CustomerProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; from?: string; to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "sales") {
    return (
      <NoPermission text="无权限访问客户画像（管理员/老板）" />
    );
  }

  const params = await searchParams;
  const customerId = params.customerId ? Number(params.customerId) : undefined;
  const { orders, profileRows } = await buildCustomerProfile(params.from, params.to);

  // 选中客户明细
  const selected =
    customerId !== undefined ? profileRows.find((r) => r.id === customerId) : undefined;
  const detailOrders =
    selected !== undefined
      ? orders
          .filter((o) => o.customerId === selected.id)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      : [];

  const summaryTotal = profileRows.reduce(
    (s, r) => ({ count: s.count + r.count, sales: s.sales + r.sales, cost: s.cost + r.cost }),
    { count: 0, sales: 0, cost: 0 }
  );
  const summaryProfit = summaryTotal.sales - summaryTotal.cost;
  const summaryMargin = summaryTotal.sales > 0 ? (summaryProfit / summaryTotal.sales) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">客户画像</h1>
        <RelatedLinks
          links={[
            { href: "/sales-analysis", label: "销售分析" },
            { href: "/receivables-payables?view=receivable", label: "看谁还欠钱" },
          ]}
        />
        <form className="flex items-end gap-2">
          <div>
            <label htmlFor="from" className="block text-xs font-medium text-gray-600">开始</label>
            <input id="from" type="date" name="from" defaultValue={params.from} className={`${inputBase} mt-1`} />
          </div>
          <div>
            <label htmlFor="to" className="block text-xs font-medium text-gray-600">结束</label>
            <input id="to" type="date" name="to" defaultValue={params.to} className={`${inputBase} mt-1`} />
          </div>
          {customerId !== undefined && <input type="hidden" name="customerId" value={customerId} />}
          <button type="submit" className={btnSecondary}>
            查询
          </button>
        </form>
      </div>

      <DateShortcuts
        basePath="/customer-profile"
        extraQuery={{ customerId: customerId != null ? String(customerId) : "" }}
      />

      {selected !== undefined && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-base font-semibold text-gray-900">{selected.name}</span>
            {selected.groupName && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{selected.groupName}</span>
            )}
            {selected.tagNames.map((t) => (
              <span key={t} className={badgeMuted}>{t}</span>
            ))}
            <Link href="/customer-profile" className="ml-auto text-sm text-gray-500 hover:underline">
              ← 返回全部客户
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="成交单数" value={`${selected.count} 单`} />
            <MiniStat label="销售额" value={`¥${selected.sales.toFixed(2)}`} />
            <MiniStat label="毛利（成本快照）" value={`¥${selected.profit.toFixed(2)}`} colorClass={selected.profit >= 0 ? "text-green-700" : "text-red-600"} />
            <MiniStat label="平均利润率" value={`${selected.margin.toFixed(2)}%`} colorClass={selected.margin >= 0 ? "text-green-700" : "text-red-600"} />
          </div>

          <div className="mt-4 space-y-2">
            {detailOrders.length === 0 && (
              <p className="text-sm text-gray-400">该期间内无销售记录</p>
            )}
            {detailOrders.map((o) => {
              const orderCost = o.items.reduce((s, it) => s + Number(it.costAmount), 0);
              const orderProfit = Number(o.totalAmount) - orderCost;
              return (
                <details key={o.id} className="rounded-lg border border-gray-100">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-4 px-3 py-2 text-sm">
                    <span className="font-medium text-gray-900">{o.orderNo}</span>
                    <span className="text-gray-600">{o.createdAt.toLocaleString("zh-CN")}</span>
                    <span className="text-gray-900">¥{Number(o.totalAmount).toFixed(2)}</span>
                    <span className={`text-gray-600 ${orderProfit >= 0 ? "text-green-700" : "text-red-600"}`}>
                      毛利 ¥{orderProfit.toFixed(2)}
                    </span>
                    <span className="text-xs text-gray-400">点击展开商品明细</span>
                  </summary>
                  <div className="border-t border-gray-100 px-3 py-2">
                    <table className="w-full max-w-2xl text-sm">
                      <thead className="text-left text-xs text-gray-500">
                        <tr>
                          <th className="py-1 font-medium">商品</th>
                          <th className="py-1 text-right font-medium tabular-nums">数量</th>
                          <th className="py-1 text-right font-medium tabular-nums">售价</th>
                          <th className="py-1 text-right font-medium tabular-nums">金额</th>
                          <th className="py-1 text-right font-medium tabular-nums">成本</th>
                          <th className="py-1 text-right font-medium tabular-nums">利润</th>
                        </tr>
                      </thead>
                      <tbody>
                        {o.items.map((it) => {
                          const profit = Number(it.amount) - Number(it.costAmount);
                          return (
                            <tr key={it.id} className="text-gray-900">
                              <td className="py-1">{it.product.code} {it.product.name}</td>
                              <td className="py-1 text-right tabular-nums">{Number(it.quantity).toFixed(3)} {it.unit.name}</td>
                              <td className="py-1 text-right tabular-nums">¥{Number(it.unitPrice).toFixed(2)}</td>
                              <td className="py-1 text-right tabular-nums">¥{Number(it.amount).toFixed(2)}</td>
                              <td className="py-1 text-right text-gray-600 tabular-nums">¥{Number(it.costAmount).toFixed(2)}</td>
                              <td className={`py-1 text-right tabular-nums ${profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                                ¥{profit.toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">客户</th>
              <th className="px-4 py-3 font-medium">组织</th>
              <th className="px-4 py-3 font-medium">标签</th>
              <th className="px-4 py-3 text-right font-medium tabular-nums">成交单数</th>
              <th className="px-4 py-3 text-right font-medium tabular-nums">销售额</th>
              <th className="px-4 py-3 text-right font-medium tabular-nums">成本</th>
              <th className="px-4 py-3 text-right font-medium tabular-nums">毛利</th>
              <th className="px-4 py-3 text-right font-medium tabular-nums">平均利润率</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
            {profileRows.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <EmptyState
                    title="该期间无销售数据"
                    hint="换个时间范围，或先开一张售卖单"
                    action={{ href: "/sale-orders/new", label: "+ 去开售卖单" }}
                  />
                </td>
              </tr>
            )}
            {profileRows.map((r) => (
              <tr key={r.id} className={r.id === customerId ? "bg-blue-50/60" : ""}>
                <td className="px-4 py-2.5 text-gray-900">{r.name}</td>
                <td className="px-4 py-2.5">
                  {r.groupName ? (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{r.groupName}</span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {r.tagNames.map((t) => (
                      <span key={t} className={badgeMuted}>{t}</span>
                    ))}
                    {r.tagNames.length === 0 && <span className="text-gray-400">—</span>}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right text-gray-900 tabular-nums">{r.count}</td>
                <td className="px-4 py-2.5 text-right text-gray-900 tabular-nums">¥{r.sales.toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">¥{r.cost.toFixed(2)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${r.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                  ¥{r.profit.toFixed(2)}
                </td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${r.margin >= 0 ? "text-green-700" : "text-red-600"}`}>
                  {r.margin.toFixed(2)}%
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/customer-profile?customerId=${r.id}${params.from ? `&from=${params.from}` : ""}${params.to ? `&to=${params.to}` : ""}`}
                    className="text-blue-600 hover:underline"
                  >
                    看明细
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr className="font-medium text-gray-900">
              <td colSpan={3} className="px-4 py-3 text-right">合计（{profileRows.length} 个客户）</td>
              <td className="px-4 py-3 text-right tabular-nums">{summaryTotal.count}</td>
              <td className="px-4 py-3 text-right tabular-nums">¥{summaryTotal.sales.toFixed(2)}</td>
              <td className="px-4 py-3 text-right tabular-nums">¥{summaryTotal.cost.toFixed(2)}</td>
              <td className="px-4 py-3 text-right tabular-nums">¥{summaryProfit.toFixed(2)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{summaryMargin.toFixed(2)}%</td>
              <td className="px-4 py-3"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function MiniStat({ label, value, colorClass }: { label: string; value: string; colorClass?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-base font-semibold ${colorClass ?? "text-gray-900"}`}>{value}</div>
    </div>
  );
}
