import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";

/**
 * 健康检查（供外部监控探测）：
 * - db：数据库连通性
 * - backupFresh：备份目录中最近一个加密备份是否在 26 小时内（每日 02:00 备份，26h 容忍一次延迟）
 * 返回 200 = 正常；503 = 异常（监控据此告警）。不暴露任何业务数据。
 */
export const dynamic = "force-dynamic";

const BACKUP_DIR = process.env.BACKUP_DIR ?? "/backups";
const MAX_AGE_MS = 26 * 60 * 60 * 1000;

export async function GET() {
  let db = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = false;
  }

  let backupFresh: boolean | null = null; // null = 目录未挂载（本地开发），跳过该检查
  try {
    const files = (await readdir(BACKUP_DIR)).filter((f) => f.endsWith(".gpg"));
    let newest = 0;
    for (const f of files) {
      const s = await stat(join(BACKUP_DIR, f));
      if (s.mtimeMs > newest) newest = s.mtimeMs;
    }
    backupFresh = newest > 0 && Date.now() - newest <= MAX_AGE_MS;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") backupFresh = false;
  }

  const ok = db && backupFresh !== false;
  return NextResponse.json(
    { ok, db, backupFresh },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
