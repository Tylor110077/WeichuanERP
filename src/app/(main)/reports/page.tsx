import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { buildReport, REPORT_TABS, type ReportTabKey } from "@/lib/reports";
import { DateShortcuts } from "@/components/date-shortcuts";

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
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限访问报表中心（管理员/老板）
      </div>
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
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">报表中心</h1>
        <Link
          href={`/reports/export?${exportParams.toString()}`}
          className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700"
        >
          导出 Excel
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {REPORT_TABS.map((t) => (
          <Link
            key={t.key}
            href={`/reports?tab=${t.key}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tab === t.key ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <DateShortcuts basePath="/reports" extraQuery={{ tab }} />

      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <label htmlFor="from" className="block text-xs font-medium text-gray-600">
            开始日期（默认本月 1 日）
          </label>
          <input id="from" type="date" name="from" defaultValue={from} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label htmlFor="to" className="block text-xs font-medium text-gray-600">
            结束日期（默认今天）
          </label>
          <input id="to" type="date" name="to" defaultValue={to} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <input type="hidden" name="tab" value={tab} />
        <button type="submit" className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200">
          查询
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              {result.columns.map((c) => (
                <th key={c.key} className={`px-4 py-3 font-medium ${c.align === "right" ? "text-right" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={result.columns.length} className="px-4 py-8 text-center text-gray-400">
                  期间内无数据
                </td>
              </tr>
            )}
            {result.rows.map((row, i) => (
              <tr key={i}>
                {result.columns.map((c) => {
                  const v = row[c.key];
                  const isMoney = c.key === "value" || ["amount", "paid", "returned", "unpaid", "received", "unreceived", "cost", "profit", "total", "avg", "lastPrice"].includes(c.key);
                  return (
                    <td key={c.key} className={`px-4 py-2.5 ${c.align === "right" ? "text-right" : ""} ${v == null ? "text-gray-400" : "text-gray-900"}`}>
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
