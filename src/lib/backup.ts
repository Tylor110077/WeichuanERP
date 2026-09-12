import { Readable } from "node:stream";
import { promises as fs } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { prisma } from "@/lib/prisma";

/**
 * 备份与恢复（数据迁移）。
 *
 * 设计取舍：
 * - **应用自己导出**，不依赖 mysqldump/docker exec：这样开发机、容器里都能跑，
 *   宿主机不配 cron 也能用（见 instrumentation.ts 的定时检查）。
 * - **备份的是一个 gzip 压缩包**（内部是 JSON），含数据 + 清单（每张表行数、时间、格式版本）。
 * - **只含数据不含表结构**：表结构由 Prisma 迁移管理（`prisma migrate deploy`），
 *   所以恢复时也不碰 `_prisma_migrations`，否则会把迁移历史改回去、导致后续迁移重放失败。
 * - 类型按原样保留：DECIMAL/DateTime/BigInt/Buffer/JSON 都用带类型标记的形式序列化，
 *   恢复时还原成同样的值，做到"一字不差"（对拍见 tests/backup.test.ts）。
 */

/** 备份格式版本：不兼容时直接拒绝，避免用错格式把数据写坏 */
export const BACKUP_FORMAT = 1;

/** 不参与备份/恢复的表：迁移历史由 Prisma 管理 */
const EXCLUDED_TABLES = new Set(["_prisma_migrations"]);

export interface BackupManifest {
  format: number;
  createdAt: string;
  /** 每张表的行数（恢复后逐一核对，防止"看起来成功"） */
  tables: { name: string; rows: number }[];
  totalRows: number;
}

export interface BackupPayload {
  manifest: BackupManifest;
  data: Record<string, unknown[]>;
}

type Encoded =
  | null
  | boolean
  | number
  | string
  | { __t: "Decimal"; v: string }
  | { __t: "Date"; v: string }
  | { __t: "BigInt"; v: string }
  | { __t: "Buffer"; v: string }
  | { __t: "Json"; v: string };

/** 转义后的值 → 可 JSON 化（保留类型，避免 Decimal 变浮点、日期丢时区） */
function encode(value: unknown): Encoded {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "bigint") return { __t: "BigInt", v: value.toString() };
  if (value instanceof Date) return { __t: "Date", v: value.toISOString() };
  if (Buffer.isBuffer(value)) return { __t: "Buffer", v: value.toString("base64") };
  if (typeof value === "object") {
    // Prisma 的 Decimal 有 toFixed / toJSON
    const maybe = value as { toFixed?: unknown; toJSON?: () => unknown };
    if (typeof maybe.toFixed === "function") return { __t: "Decimal", v: String(maybe) };
    return { __t: "Json", v: JSON.stringify(value) };
  }
  return String(value);
}

/** 解码回可直接绑定到 SQL 参数的值 */
function decode(value: Encoded): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  switch (value.__t) {
    case "Decimal":
      return value.v;
    case "Date":
      return new Date(value.v);
    case "BigInt":
      return BigInt(value.v);
    case "Buffer":
      return Buffer.from(value.v, "base64");
    case "Json":
      return value.v;
  }
}

/** 当前库里的所有业务表（排除迁移历史） */
export async function listTables(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Record<string, string>[]>("SHOW TABLES");
  return rows
    .map((r) => Object.values(r)[0])
    .filter((name) => typeof name === "string" && !EXCLUDED_TABLES.has(name))
    .sort();
}

/** 备份目录（可用 BACKUP_DIR 指定；容器里挂的是 /backups） */
export function backupDir(): string {
  // 一律解析成绝对路径：BACKUP_DIR 可能是相对的（如 .env 里写 ./backups），
  // 后续拼路径时若还是相对路径，容易被重复拼接（曾因此出现 ./backups/backups/…）
  return path.resolve(process.env.BACKUP_DIR ?? path.join(process.cwd(), "backups"));
}

/** 备份与调度配置，存在备份目录里（改配置不需要动数据库） */
export interface BackupConfig {
  /** 备份周期（小时）：默认 24 = 每天一次 */
  intervalHours: number;
  /** 保留最近几份（更旧的自动删除） */
  keep: number;
}

export const DEFAULT_BACKUP_CONFIG: BackupConfig = { intervalHours: 24, keep: 14 };

function configPath(): string {
  return path.join(backupDir(), "backup-config.json");
}

export async function readBackupConfig(): Promise<BackupConfig> {
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<BackupConfig>;
    return {
      intervalHours: clamp(Number(parsed.intervalHours) || DEFAULT_BACKUP_CONFIG.intervalHours, 1, 24 * 30),
      keep: clamp(Number(parsed.keep) || DEFAULT_BACKUP_CONFIG.keep, 1, 365),
    };
  } catch {
    return DEFAULT_BACKUP_CONFIG;
  }
}

export async function writeBackupConfig(cfg: BackupConfig): Promise<BackupConfig> {
  const next: BackupConfig = {
    intervalHours: clamp(Math.round(cfg.intervalHours), 1, 24 * 30),
    keep: clamp(Math.round(cfg.keep), 1, 365),
  };
  await fs.mkdir(backupDir(), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 备份文件名：weichuan-backup-2026-09-12T19-30-05.json.gz（按时间可排序） */
export function backupFileName(date = new Date()): string {
  const iso = date.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  return `weichuan-backup-${iso}.json.gz`;
}

export interface BackupFileInfo {
  file: string;
  bytes: number;
  createdAt: string;
  manifest?: BackupManifest;
}

/** 列出备份文件（新→旧）；清单能解析出来就带上，便于界面显示行数 */
export async function listBackups(): Promise<BackupFileInfo[]> {
  await fs.mkdir(backupDir(), { recursive: true });
  const names = (await fs.readdir(backupDir())).filter((n) => n.endsWith(".json.gz"));
  const out: BackupFileInfo[] = [];
  for (const name of names) {
    const full = path.join(backupDir(), name);
    const st = await fs.stat(full);
    let manifest: BackupManifest | undefined;
    try {
      // 传文件名即可（readBackupFile 会自己拼目录）；传拼好的路径反而会被再拼一次
      const payload = await readBackupFile(name);
      manifest = payload.manifest;
    } catch {
      manifest = undefined; // 文件损坏时也要能列出来（界面上标出来）
    }
    out.push({ file: name, bytes: st.size, createdAt: st.mtime.toISOString(), manifest });
  }
  return out.sort((a, b) => (a.file < b.file ? 1 : -1));
}

/** 导出全库数据（按表读取，逐表编码），返回压缩前的 payload */
export async function dumpAll(): Promise<BackupPayload> {
  const tables = await listTables();
  const data: Record<string, unknown[]> = {};
  const manifestTables: BackupManifest["tables"] = [];
  for (const table of tables) {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM \`${table}\``);
    data[table] = rows.map((row) => {
      const encoded: Record<string, Encoded> = {};
      for (const [k, v] of Object.entries(row)) encoded[k] = encode(v);
      return encoded;
    });
    manifestTables.push({ name: table, rows: rows.length });
  }
  return {
    manifest: {
      format: BACKUP_FORMAT,
      createdAt: new Date().toISOString(),
      tables: manifestTables,
      totalRows: manifestTables.reduce((s, t) => s + t.rows, 0),
    },
    data,
  };
}

/** 生成一份备份压缩包，返回文件信息（大小、行数） */
export async function createBackup(): Promise<BackupFileInfo> {
  const payload = await dumpAll();
  const json = JSON.stringify(payload);
  const gz = zlib.gzipSync(Buffer.from(json, "utf8"), { level: 9 });
  await fs.mkdir(backupDir(), { recursive: true });
  const file = backupFileName();
  await fs.writeFile(path.join(backupDir(), file), gz);
  return { file, bytes: gz.length, createdAt: payload.manifest.createdAt, manifest: payload.manifest };
}

/** 读取并解压一个备份包（支持绝对路径或备份目录内的文件名） */
export async function readBackupFile(fileOrPath: string): Promise<BackupPayload> {
  const full = path.isAbsolute(fileOrPath) ? fileOrPath : path.join(backupDir(), fileOrPath);
  const buf = await fs.readFile(full);
  const json = zlib.gunzipSync(buf).toString("utf8");
  const payload = JSON.parse(json) as BackupPayload;
  if (payload?.manifest?.format !== BACKUP_FORMAT) {
    throw new Error("备份文件格式不受支持");
  }
  return payload;
}

/** 从上传的内容（gzip 二进制）解析备份包 */
export function parseBackupBuffer(buf: Buffer): BackupPayload {
  const json = zlib.gunzipSync(buf).toString("utf8");
  const payload = JSON.parse(json) as BackupPayload;
  if (payload?.manifest?.format !== BACKUP_FORMAT) {
    throw new Error("备份文件格式不受支持");
  }
  return payload;
}

export interface RestoreResult {
  manifest: BackupManifest;
  /** 恢复后逐表核对的行数 */
  verified: { name: string; expected: number; actual: number; ok: boolean }[];
}

/**
 * 用备份包覆盖当前数据。
 *
 * - 关掉外键检查做全表替换（与 mysqldump 的恢复方式一致），避免纠结插入顺序；
 * - 每张表先 DELETE 再批量 INSERT（显式带上 id，自增计数器会自动跟到 max+1）；
 * - 恢复完逐表核对行数，任何一张对不上就抛错（宁可报错也不要"看起来成功"）。
 */
export async function restoreBackup(payload: BackupPayload): Promise<RestoreResult> {
  const tables = await listTables();
  const manifestTables = payload.manifest.tables;
  // 只恢复"当前库里有、备份里也有"的表；备份里有而库里没有的（迁移新增表）跳过
  const toRestore = tables.filter((t) => Array.isArray(payload.data[t]));

  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
  try {
    for (const table of toRestore) {
      await prisma.$executeRawUnsafe(`DELETE FROM \`${table}\``);
      const rows = payload.data[table] as Record<string, Encoded>[];
      if (rows.length === 0) continue;
      // 按批次插入，避免一条 SQL 过长（MySQL 默认 max_allowed_packet 16M）
      const BATCH = 200;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const cols = Object.keys(chunk[0]);
        const placeholders = chunk.map(() => `(${cols.map(() => "?").join(",")})`).join(",");
        const values = chunk.flatMap((row) => cols.map((c) => decode(row[c])));
        await prisma.$executeRawUnsafe(
          `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(",")}) VALUES ${placeholders}`,
          ...values
        );
      }
    }
  } finally {
    await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
  }

  const verified: RestoreResult["verified"] = [];
  for (const t of manifestTables) {
    if (!toRestore.includes(t.name)) continue;
    const rows = await prisma.$queryRawUnsafe<{ c: bigint | number }[]>(
      `SELECT COUNT(*) AS c FROM \`${t.name}\``
    );
    const actual = Number(rows[0]?.c ?? 0);
    verified.push({ name: t.name, expected: t.rows, actual, ok: actual === t.rows });
  }
  const bad = verified.filter((v) => !v.ok);
  if (bad.length > 0) {
    throw new Error(
      `恢复后行数不一致：${bad.map((b) => `${b.name} 期望 ${b.expected} 实际 ${b.actual}`).join("；")}`
    );
  }
  return { manifest: payload.manifest, verified };
}

/** 只保留最近 keep 份，返回被删除的文件名 */
export async function pruneBackups(keep: number): Promise<string[]> {
  const all = await listBackups();
  const stale = all.slice(keep);
  for (const s of stale) {
    await fs.rm(path.join(backupDir(), s.file), { force: true });
  }
  return stale.map((s) => s.file);
}

/** 是否到了该备份的时间（定时检查用）：没有备份、或距最近一份已超过 intervalHours */
export async function isBackupDue(config?: BackupConfig): Promise<boolean> {
  const cfg = config ?? (await readBackupConfig());
  const all = await listBackups();
  if (all.length === 0) return true;
  const latest = new Date(all[0].createdAt).getTime();
  return Date.now() - latest >= cfg.intervalHours * 3600 * 1000;
}

/** 删除某个备份文件 */
export async function deleteBackup(file: string): Promise<void> {
  const full = path.isAbsolute(file) ? file : path.join(backupDir(), file);
  await fs.rm(full, { force: true });
}

/** 读取备份文件内容用于下载（返回 Buffer 流） */
export async function backupStream(file: string): Promise<Readable> {
  const full = path.isAbsolute(file) ? file : path.join(backupDir(), file);
  const buf = await fs.readFile(full);
  return Readable.from(buf);
}
