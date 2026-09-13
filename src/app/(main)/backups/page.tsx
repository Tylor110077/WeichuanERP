import { redirect } from "next/navigation";
import { NoPermission } from "@/components/empty-state";
import { getCurrentUser } from "@/lib/auth/session";
import { backupDir, listBackups, readBackupConfig } from "@/lib/backup";
import { BackupConfigForm, BackupNowButton, DeleteBackupForm, RestoreForm } from "./backup-forms";

export const metadata = { title: "备份与恢复 - 玮川进销存" };

function fmtBytes(n: number): string {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export default async function BackupsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return <NoPermission text="无权限（仅管理员可备份与恢复）" />;
  }

  const [cfg, backups] = await Promise.all([readBackupConfig(), listBackups()]);
  const totalRows = backups[0]?.manifest?.totalRows;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">
          备份与恢复
          <span className="ml-3 text-sm font-normal text-gray-500">
            数据全量打包成压缩包，可下载留存、也可导入还原
          </span>
        </h1>
        <BackupNowButton />
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">自动备份周期</h2>
        <p className="mb-3 text-xs text-gray-500">
          服务每小时检查一次，距最近一份备份超过下面的周期就自动再备份一份（不需要在服务器上配 cron）。
          备份文件保存在 <code className="rounded bg-gray-100 px-1">{backupDir()}</code>
          ——生产环境该目录来自 <code className="rounded bg-gray-100 px-1">docker-compose.yml</code> 里挂的{" "}
          <code className="rounded bg-gray-100 px-1">./backups</code>，建议再定期拷到别处（异地留存）。
        </p>
        <BackupConfigForm intervalHours={cfg.intervalHours} keep={cfg.keep} />
      </section>

      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">备份记录</h2>
          <span className="text-xs text-gray-500">
            共 {backups.length} 份
            {totalRows != null && ` ・ 最近一份 ${totalRows} 行`}
            {` ・ 保留最近 ${cfg.keep} 份`}
          </span>
        </div>
        <div className="scroll-thin max-h-[28rem] overflow-auto">
          <table className="w-full divide-y divide-gray-200 text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="whitespace-nowrap px-5 py-3 font-medium">文件</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">备份时间</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">大小</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">行数</th>
                <th className="whitespace-nowrap px-5 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 [&>tr:hover]:bg-gray-100/70">
              {backups.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-gray-400">
                    还没有备份，点右上角「立即备份」生成第一份
                  </td>
                </tr>
              )}
              {backups.map((b) => (
                <tr key={b.file}>
                  <td className="px-5 py-2.5 text-gray-900">{b.file}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                    {new Date(b.createdAt).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 tabular-nums">{fmtBytes(b.bytes)}</td>
                  <td className="px-4 py-2.5 text-gray-600 tabular-nums">
                    {b.manifest ? b.manifest.totalRows : "（清单不可读）"}
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5">
                    <a
                      href={`/backups/download?file=${encodeURIComponent(b.file)}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      下载
                    </a>
                    <span className="mx-2 text-gray-300">|</span>
                    <DeleteBackupForm file={b.file} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-5">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">导入备份包恢复数据</h2>
        <p className="mb-3 text-xs text-gray-600">
          选一个本系统导出的 <code className="rounded bg-white px-1">.json.gz</code> 压缩包，恢复后数据与备份时**完全一致**。
          恢复是<strong>覆盖式</strong>的：当前全部数据会被替换（表结构不动，由 Prisma 迁移管理）；
          系统会先自动备份一次当前数据，万一恢复错了还能退回来。
        </p>
        <RestoreForm />
      </section>
    </div>
  );
}
