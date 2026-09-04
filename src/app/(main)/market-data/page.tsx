import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { MarketDataForm } from "./market-data-form";
import { DeleteCuPriceButton } from "./delete-button";

export const metadata = { title: "行情管理 - 玮川进销存" };

/** 铜价行情维护（工作台趋势图数据源）：每日价格 + 当日时点序列。 */
export default async function MarketDataPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限访问行情管理（仅管理员）
      </div>
    );
  }

  const rows = await prisma.cuPrice.findMany({
    orderBy: { priceDate: "desc" },
    take: 60,
  });

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">行情管理（铜价）</h1>
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">
          查看工作台图表
        </Link>
      </div>

      <MarketDataForm defaultDate={todayStr} />

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">日期</th>
              <th className="px-4 py-3 text-right font-medium">铜价（元/吨）</th>
              <th className="px-4 py-3 font-medium">当日时点</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  暂无行情数据，请先录入
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const points = Array.isArray(r.intraday)
                ? (r.intraday as { time: string; price: number }[])
                : [];
              return (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 text-gray-900">
                    {r.priceDate.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                    ¥{Number(r.price).toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {points.length > 0
                      ? points.map((p) => `${p.time} ¥${p.price}`).join(" ｜ ")
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <DeleteCuPriceButton id={r.id} />
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
