import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { BACKUP_FORMAT, backupFileName, parseBackupBuffer } from "../src/lib/backup";

/**
 * 回归背景：备份包是"最后一根救命稻草"——导入时必须严格校验，
 * 不能把别的文件（或损坏的文件）当成备份往库里灌。这里锁住格式校验与文件命名。
 */

function gz(obj: unknown): Buffer {
  return zlib.gzipSync(Buffer.from(JSON.stringify(obj), "utf8"));
}

test("合法的备份包能解析出清单", () => {
  const payload = {
    manifest: { format: BACKUP_FORMAT, createdAt: "2026-09-12T10:00:00.000Z", tables: [{ name: "users", rows: 1 }], totalRows: 1 },
    data: { users: [{ id: 1 }] },
  };
  const parsed = parseBackupBuffer(gz(payload));
  assert.equal(parsed.manifest.totalRows, 1);
  assert.equal(parsed.manifest.tables[0].name, "users");
});

test("格式版本不符 / 不是 JSON / 没解压的文件都要被拒绝", () => {
  // 版本不对（将来格式升级时，旧版本程序不能硬读新包）
  assert.throws(() => parseBackupBuffer(gz({ manifest: { format: BACKUP_FORMAT + 1 }, data: {} })));
  // 是 gzip 但里面不是 JSON
  assert.throws(() => parseBackupBuffer(zlib.gzipSync(Buffer.from("不是 JSON", "utf8"))));
  // 压根不是 gzip（比如随手选了个别的文件）
  assert.throws(() => parseBackupBuffer(Buffer.from("hello", "utf8")));
  // 是 JSON 但没有 manifest
  assert.throws(() => parseBackupBuffer(gz({ data: {} })));
});

test("备份文件名按时间可排序（同一天多次备份也不会重名）", () => {
  const a = backupFileName(new Date("2026-09-12T10:00:00.000Z"));
  const b = backupFileName(new Date("2026-09-12T10:00:01.000Z"));
  assert.match(a, /^weichuan-backup-2026-09-12T10-00-00Z\.json\.gz$/);
  assert.ok(a < b, "后生成的应排在后面");
});
