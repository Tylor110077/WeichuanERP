import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "审计日志 - 玮川进销存" };

const PAGE_SIZE = 20;

const ACTION_LABELS: Record<string, string> = {
  login: "登录",
  logout: "登出",
  create: "创建",
  update: "更新",
  delete: "删除",
  receive: "确认入库",
  void: "作废",
  reset_password: "重置密码",
};

function jsonText(value: unknown): string | null {
  if (value == null) return null;
  return JSON.stringify(value);
}

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (current.role !== "admin") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限访问审计日志（仅管理员）
      </div>
    );
  }

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const [total, logs] = await Promise.all([
    prisma.auditLog.count(),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take: PAGE_SIZE,
      include: { user: { select: { username: true, displayName: true } } },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">审计日志</h1>
        <span className="text-xs text-gray-500">共 {total} 条</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">时间</th>
              <th className="px-4 py-3 font-medium">操作人</th>
              <th className="px-4 py-3 font-medium">动作</th>
              <th className="px-4 py-3 font-medium">对象</th>
              <th className="px-4 py-3 font-medium">IP</th>
              <th className="px-4 py-3 font-medium">变更前后</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {logs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  暂无记录
                </td>
              </tr>
            )}
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                  {log.createdAt.toLocaleString("zh-CN")}
                </td>
                <td className="px-4 py-2.5 text-gray-900">
                  {log.user ? log.user.displayName : "—"}
                </td>
                <td className="px-4 py-2.5">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
                    {ACTION_LABELS[log.action] ?? log.action}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-600">
                  {log.entityType}
                  {log.entityId != null ? ` #${log.entityId}` : ""}
                </td>
                <td className="px-4 py-2.5 text-gray-600">{log.ip ?? "—"}</td>
                <td className="px-4 py-2.5">
                  {log.beforeJson == null && log.afterJson == null ? (
                    <span className="text-xs text-gray-400">—</span>
                  ) : (
                    <details>
                      <summary className="cursor-pointer text-xs text-blue-600 hover:underline">
                        查看快照
                      </summary>
                      <pre className="mt-1 max-w-xs overflow-x-auto rounded bg-gray-50 p-2 text-xs text-gray-700">
                        {log.beforeJson != null && (
                          <>
                            <div className="font-medium text-gray-500">前</div>
                            {jsonText(log.beforeJson)}
                          </>
                        )}
                        {log.afterJson != null && (
                          <>
                            <div className="mt-1 font-medium text-gray-500">后</div>
                            {jsonText(log.afterJson)}
                          </>
                        )}
                      </pre>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-3 text-sm">
          {page > 1 ? (
            <Link href={`/audit-logs?page=${page - 1}`} className="text-blue-600 hover:underline">
              上一页
            </Link>
          ) : (
            <span className="text-gray-400">上一页</span>
          )}
          <span className="text-gray-600">
            第 {page} / {totalPages} 页
          </span>
          {page < totalPages ? (
            <Link href={`/audit-logs?page=${page + 1}`} className="text-blue-600 hover:underline">
              下一页
            </Link>
          ) : (
            <span className="text-gray-400">下一页</span>
          )}
        </div>
      )}
    </div>
  );
}
