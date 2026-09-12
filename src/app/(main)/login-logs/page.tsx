import { redirect } from "next/navigation";
import { FilterForm } from "@/components/filter-form";
import { EmptyState, NoPermission } from "@/components/empty-state";
import { badgeDanger, badgeOk, btnSecondary, inputBase } from "@/lib/ui";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { DateShortcuts } from "@/components/date-shortcuts";

export const metadata = { title: "登录日志 - 玮川进销存" };

const PAGE_SIZE = 20;

/** 登录日志（文档 3.10 / 8.1：登录成功/失败均记录），仅管理员可见。 */
export default async function LoginLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; from?: string; to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return (
      <NoPermission text="无权限访问登录日志（仅管理员）" />
    );
  }

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const skip = (page - 1) * PAGE_SIZE;
  const { gte, lte } = dateRange(params.from, params.to);
  const where = { createdAt: { gte, lte } };

  const [total, logs, users] = await Promise.all([
    prisma.loginLog.count({ where }),
    prisma.loginLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: PAGE_SIZE,
    }),
    prisma.user.findMany({ select: { id: true, username: true, displayName: true } }),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">登录日志</h1>
        <span className="text-xs text-gray-500">共 {total} 条</span>
      </div>

      <DateShortcuts basePath="/login-logs" />

      <FilterForm className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <label htmlFor="from" className="block text-xs font-medium text-gray-600">开始日期</label>
          <input id="from" type="date" name="from" defaultValue={params.from} className={`${inputBase} mt-1`} />
        </div>
        <div>
          <label htmlFor="to" className="block text-xs font-medium text-gray-600">结束日期</label>
          <input id="to" type="date" name="to" defaultValue={params.to} className={`${inputBase} mt-1`} />
        </div>
        <button type="submit" className={btnSecondary}>
          查询
        </button>
        {(params.from || params.to) && (
          <a href="/login-logs" className="text-xs text-blue-600 hover:underline">清除日期</a>
        )}
      </FilterForm>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">时间</th>
              <th className="px-4 py-3 font-medium">账号</th>
              <th className="px-4 py-3 font-medium">用户</th>
              <th className="px-4 py-3 font-medium">结果</th>
              <th className="px-4 py-3 font-medium">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
            {logs.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState title="该期间无登录记录" hint="换个时间范围试试" />
                </td>
              </tr>
            )}
            {logs.map((log) => {
              const u = log.userId ? userMap.get(log.userId) : undefined;
              return (
                <tr key={log.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                    {log.createdAt.toLocaleString("zh-CN")}
                  </td>
                  <td className="px-4 py-2.5 text-gray-900">{log.username}</td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {u ? `${u.displayName}（${u.username}）` : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {log.success ? (
                      <span className={badgeOk}>成功</span>
                    ) : (
                      <span className={badgeDanger}>失败</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{log.ip ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex items-center gap-3 border-t border-gray-100 px-4 py-3 text-sm">
            {page > 1 ? (
              <Link href={`/login-logs?page=${page - 1}&${paramsStr(params)}`} className="text-blue-600 hover:underline">上一页</Link>
            ) : (
              <span className="text-gray-400">上一页</span>
            )}
            <span className="text-gray-600">第 {page} / {totalPages} 页</span>
            {page < totalPages ? (
              <Link href={`/login-logs?page=${page + 1}&${paramsStr(params)}`} className="text-blue-600 hover:underline">下一页</Link>
            ) : (
              <span className="text-gray-400">下一页</span>
            )}
          </div>
        )}
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

function paramsStr(p: { from?: string; to?: string }): string {
  const sp = new URLSearchParams();
  if (p.from) sp.set("from", p.from);
  if (p.to) sp.set("to", p.to);
  return sp.toString();
}
