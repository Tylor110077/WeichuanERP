"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { createSession } from "@/lib/auth/session";
import {
  createBackup,
  deleteBackup,
  parseBackupBuffer,
  pruneBackups,
  readBackupConfig,
  restoreBackup,
  writeBackupConfig,
} from "@/lib/backup";

export type BackupState = { error?: string; ok?: string } | null;

/** 立即备份一次（并清理超出保留数的旧包） */
export async function createBackupNowAction(): Promise<BackupState> {
  const admin = await requireAdmin();
  const cfg = await readBackupConfig();
  const info = await createBackup();
  await pruneBackups(cfg.keep);
  // 注意：审计表的 entityId 是 BigInt 列，备份用文件名标识（不是数字），
  // 所以 entityId 留空、把文件名写进 after；传字符串会被 writeAudit 内部 BigInt() 抛错而静默丢弃
  await writeAudit({
    userId: admin.id,
    action: "create",
    entityType: "backup",
    entityId: null,
    after: { file: info.file, rows: info.manifest?.totalRows, bytes: info.bytes },
  });
  revalidatePath("/backups");
  return { ok: `已备份 ${info.file}（${info.manifest?.totalRows ?? 0} 行）` };
}

export async function deleteBackupAction(formData: FormData): Promise<BackupState> {
  const admin = await requireAdmin();
  const file = String(formData.get("file") ?? "");
  if (!file) return { error: "缺少文件名" };
  await deleteBackup(file);
  await writeAudit({
    userId: admin.id,
    action: "delete",
    entityType: "backup",
    entityId: null,
    after: { file },
  });
  revalidatePath("/backups");
  return { ok: `已删除 ${file}` };
}

export async function saveBackupConfigAction(formData: FormData): Promise<BackupState> {
  const admin = await requireAdmin();
  const next = await writeBackupConfig({
    intervalHours: Number(formData.get("intervalHours")),
    keep: Number(formData.get("keep")),
  });
  await writeAudit({
    userId: admin.id,
    action: "update",
    entityType: "backup_config",
    entityId: "backup-config",
    after: next,
  });
  revalidatePath("/backups");
  return { ok: `已保存：每 ${next.intervalHours} 小时备份一次，保留最近 ${next.keep} 份` };
}

/**
 * 从上传的压缩包恢复。
 *
 * 两道保护：
 * 1. **恢复前自动备份当前数据**（万一导入的包不对，还能退回）；
 * 2. 必须显式勾选确认 —— 这一步会覆盖现有全部数据。
 * 恢复后把迁移历史（_prisma_migrations）保持原样，并给当前管理员重建登录会话，
 * 否则恢复旧包会把当前登录态一起覆盖掉。
 */
export async function restoreBackupAction(formData: FormData): Promise<BackupState> {
  const admin = await requireAdmin();
  if (formData.get("confirm") !== "yes") {
    return { error: "请先勾选「我确认要覆盖当前数据」" };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "请选择备份压缩包（.json.gz）" };

  let payload;
  try {
    payload = parseBackupBuffer(Buffer.from(await file.arrayBuffer()));
  } catch {
    return { error: "这个文件不是本系统导出的备份包（解压或格式校验失败）" };
  }

  const safety = await createBackup();
  const result = await restoreBackup(payload);
  // 恢复旧包会把会话表一起覆盖，这里给当前管理员重建一个会话，避免被登出
  await createSession(admin.id);

  await writeAudit({
    userId: admin.id,
    action: "update",
    entityType: "backup_restore",
    entityId: null,
    after: {
      恢复来源: file.name,
      备份时间: payload.manifest.createdAt,
      共行数: payload.manifest.totalRows,
      恢复前自动备份: safety.file,
    },
  });
  revalidatePath("/backups");
  return {
    ok: `已恢复 ${result.verified.length} 张表、共 ${payload.manifest.totalRows} 行（逐表核对通过）；恢复前的数据已自动备份为 ${safety.file}`,
  };
}
