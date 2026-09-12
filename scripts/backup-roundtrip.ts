/**
 * 备份/恢复的"无损"验证：导出 → 恢复 → 再导出 → 逐表逐行对拍。
 *
 * 手工运行（会覆盖当前库，但恢复的就是刚刚导出的同一份数据）：
 *   npx tsx scripts/backup-roundtrip.ts
 *
 * 为什么要有这个脚本：备份功能最怕"看着成功、其实少了东西"。
 * 这里用两次导出的结果做深比较，任何类型（Decimal/日期/JSON/二进制）丢失都会被抓出来。
 */
import { dumpAll, restoreBackup } from "../src/lib/backup";
import { prisma } from "../src/lib/prisma";

function diffRows(table: string, a: unknown[], b: unknown[]): string | null {
  if (a.length !== b.length) return `行数不同：${a.length} → ${b.length}`;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
      return `第 ${i + 1} 行不同：\n  前: ${JSON.stringify(a[i]).slice(0, 300)}\n  后: ${JSON.stringify(b[i]).slice(0, 300)}`;
    }
  }
  return null;
}

async function main() {
  console.log("① 导出……");
  const before = await dumpAll();
  console.log(`   ${before.manifest.tables.length} 张表 / ${before.manifest.totalRows} 行`);

  console.log("② 恢复（用刚导出的那份覆盖）……");
  const result = await restoreBackup(before);
  console.log(`   恢复后核对：${result.verified.filter((v) => v.ok).length}/${result.verified.length} 张表行数一致`);

  console.log("③ 再导出并对拍……");
  const after = await dumpAll();
  let bad = 0;
  for (const t of before.manifest.tables) {
    const d = diffRows(t.name, before.data[t.name] as unknown[], after.data[t.name] as unknown[]);
    if (d) {
      bad++;
      console.log(`   ❌ ${t.name}: ${d}`);
    }
  }
  if (before.manifest.totalRows !== after.manifest.totalRows) {
    bad++;
    console.log(`   ❌ 总行数不同：${before.manifest.totalRows} → ${after.manifest.totalRows}`);
  }
  console.log(bad === 0 ? "\n✅ 两次导出的数据逐行一致，恢复无损" : `\n❌ 有 ${bad} 处不一致`);
  await prisma.$disconnect();
  process.exit(bad === 0 ? 0 : 1);
}

main();
