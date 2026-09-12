/**
 * 服务端启动钩子：备份调度。
 *
 * 为什么放在这里：应用自身没有 cron，而备份又必须"每天自动一次"。
 * 这里在服务进程启动后每小时检查一次是否到了备份周期（周期可在界面里改），
 * 到点就备份并清理旧包。这样不依赖宿主机 cron 也能自动备份；
 * 若更愿意用系统 cron，也可以每天调 `npx tsx scripts/backup.ts --if-due`（同样的判断逻辑）。
 */
export async function register() {
  // 只在 Node.js 运行时执行（Edge runtime 里没有 fs / prisma）
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // dev 下 HMR 可能多次执行，用全局标记防重复
  const g = globalThis as unknown as { __wcBackupTimer?: NodeJS.Timeout };
  if (g.__wcBackupTimer) return;

  const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 每小时看一眼
  const RUN_AFTER_START_MS = 60 * 1000; // 启动 1 分钟后先看一次

  const tick = async () => {
    try {
      const { isBackupDue, createBackup, pruneBackups, readBackupConfig } = await import("@/lib/backup");
      const cfg = await readBackupConfig();
      if (!(await isBackupDue(cfg))) return;
      const info = await createBackup();
      await pruneBackups(cfg.keep);
      console.log(`[backup] 已自动备份 ${info.file}（${info.manifest?.totalRows} 行）`);
    } catch (e) {
      // 备份失败不能影响应用本身
      console.error("[backup] 自动备份失败：", e instanceof Error ? e.message : e);
    }
  };

  g.__wcBackupTimer = setInterval(tick, CHECK_INTERVAL_MS);
  setTimeout(tick, RUN_AFTER_START_MS);
}
