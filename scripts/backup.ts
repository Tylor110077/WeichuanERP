/**
 * 备份命令行入口。
 *
 *   npx tsx scripts/backup.ts            # 立即备份一次（并清理超出保留数的旧备份）
 *   npx tsx scripts/backup.ts --if-due   # 只在"距上次备份已超过配置周期"时才备份（给系统 cron 用）
 *   npx tsx scripts/backup.ts --list     # 只看有哪些备份
 *   npx tsx scripts/backup.ts --restore=weichuan-backup-xxx.json.gz --yes
 *
 * 备份目录由 BACKUP_DIR 决定（默认 ./backups；容器里是 /backups）。
 * 周期与保留份数写在备份目录的 backup-config.json 里（界面「备份与恢复」也能改）。
 */
import { createBackup, isBackupDue, listBackups, pruneBackups, readBackupConfig, readBackupFile, restoreBackup } from "../src/lib/backup";
import { prisma } from "../src/lib/prisma";

function fmtBytes(n: number): string {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

async function main() {
  const args = process.argv.slice(2);
  const cfg = await readBackupConfig();

  if (args.includes("--list")) {
    const all = await listBackups();
    if (all.length === 0) {
      console.log("（还没有备份）");
    } else {
      for (const b of all) {
        console.log(`${b.file}  ${fmtBytes(b.bytes)}  ${b.manifest ? `${b.manifest.totalRows} 行` : "清单不可读"}`);
      }
    }
    return;
  }

  const restoreArg = args.find((a) => a.startsWith("--restore="));
  if (restoreArg) {
    if (!args.includes("--yes")) {
      console.error("恢复会覆盖当前全部数据。确认无误请加 --yes 再执行。");
      process.exit(1);
    }
    const file = restoreArg.slice("--restore=".length);
    const payload = await readBackupFile(file);
    // 恢复前先自动备份当前数据，给自己留退路
    const safety = await createBackup();
    console.log(`已先备份当前数据：${safety.file}`);
    const result = await restoreBackup(payload);
    console.log(`已从 ${file} 恢复：${result.verified.length} 张表、共 ${result.manifest.totalRows} 行（逐表核对通过）`);
    return;
  }

  if (args.includes("--if-due")) {
    if (!(await isBackupDue(cfg))) {
      console.log(`未到备份时间（周期 ${cfg.intervalHours} 小时），跳过`);
      return;
    }
  }

  const info = await createBackup();
  console.log(`备份完成：${info.file}（${fmtBytes(info.bytes)}，${info.manifest?.totalRows} 行）`);
  const removed = await pruneBackups(cfg.keep);
  if (removed.length > 0) console.log(`已清理旧备份：${removed.join("、")}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
