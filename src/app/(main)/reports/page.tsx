import { redirect } from "next/navigation";
import { FilterForm } from "@/components/filter-form";
import { EmptyState, NoPermission } from "@/components/empty-state";
import { btnSecondary, btnSuccess, inputBase, segActive } from "@/lib/ui";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { buildReport, MAX_REPORT_ROWS, REPORT_TABS, type ReportTabKey } from "@/lib/reports";
import { DateShortcuts } from "@/components/date-shortcuts";
import { RelatedLinks } from "@/components/related-links";

export const metadata = { title: "报表中心 - 玮川进销存" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "sales") {
    return (
      <NoPermission text="无权限访问报表中心（管理员/老板）" />
    );
  }

  const params = await searchParams;
  const tab = (REPORT_TABS.some((t) => t.key === params.tab) ? params.tab : "summary") as ReportTabKey;
  const from = params.from;
  const to = params.to;
  const result = await buildReport(tab, from, to);

  const exportParams = new URLSearchParams({ tab });
  if (from) exportParams.set("from", from);
  if (to) exportParams.set("to", to);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-900">报表中心</h1>
          <RelatedLinks
            links={[
              { href: "/sales-analysis", label: "销售分析" },
              { href: "/receivables-payables", label: "应收应付" },
              { href: "/inventory", label: "库存查询" },
            ]}
          />
        </div>
        <Link
          href={`/reports/export?${exportParams.toString()}`}
          className={btnSuccess}
        >
          导出 Excel
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {REPORT_TABS.map((t) => (
          <Link
            key={t.key}
            href={`/reports?tab=${t.key}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`}
            className={`px-3 py-1.5 text-sm ${tab === t.key ? segActive : "rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <DateShortcuts basePath="/reports" extraQuery={{ tab }} />

      <FilterForm className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <label htmlFor="from" className="block text-xs font-medium text-gray-600">
            开始日期（默认本月 1 日）
          </label>
          <input id="from" type="date" name="from" defaultValue={from} className={`${inputBase} mt-1`} />
        </div>
        <div>
          <label htmlFor="to" className="block text-xs font-medium text-gray-600">
            结束日期（默认今天）
          </label>
          <input id="to" type="date" name="to" defaultValue={to} className={`${inputBase} mt-1`} />
        </div>
        <input type="hidden" name="tab" value={tab} />
        <button type="submit" className={btnSecondary}>
          查询
        </button>
      </FilterForm>

      {result.capped && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          数据量较大，下表仅展示前 {MAX_REPORT_ROWS} 行（按时间倒序）。完整数据请点右上角「导出 Excel」。
        </p>
      )}

      <div className="scroll-thin max-h-[32rem] overflow-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          {/* 结果已封顶 300 行，这里再给个高度上限 + 表头吸顶，翻看长报表时不用来回滚 */}
          <thead className="sticky top-0 z-10 bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              {result.columns.map((c) => (
                <th key={c.key} className={`px-4 py-3 font-medium ${c.align === "right" ? "text-right tabular-nums" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={result.columns.length}>
                  <EmptyState title="该期间无数据" hint="换个报表类型或时间范围试试" />
                </td>
              </tr>
            )}
            {result.rows.map((row, i) => (
              <tr key={i}>
                {result.columns.map((c) => {
                  const v = row[c.key];
                  const isMoney = c.key === "value" || ["amount", "paid", "returned", "unpaid", "received", "unreceived", "cost", "profit", "total", "avg", "lastPrice"].includes(c.key);
                  return (
                    <td key={c.key} className={`px-4 py-2.5 ${c.align === "right" ? "text-right tabular-nums" : ""} ${v == null ? "text-gray-400" : "text-gray-900"}`}>
                      {v == null
                        ? "—"
                        : isMoney && typeof v === "number"
                          ? `¥${v.toFixed(2)}`
                          : typeof v === "number"
                            ? v.toFixed(3).replace(/\.?0+$/, "")
                            : v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
