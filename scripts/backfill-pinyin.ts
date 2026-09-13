/**
 * 回填 `search_pinyin`（拼音首字母搜索用）。
 *
 * 什么时候要跑：
 * - 迁移 `20260912210000_search_pinyin` 上线之后（历史数据只有中文，没有拼音串）；
 * - 怀疑有脏数据时（比如直接改过库、或某次写入绕过了 Prisma 扩展）。
 *
 * 幂等：每次全量重算，跑几次都一样。生产部署时建议在 `prisma migrate deploy` 之后执行一次：
 *   npx tsx scripts/backfill-pinyin.ts
 */
import { PrismaClient } from "@prisma/client";
import { searchPinyin } from "../src/lib/pinyin-server";

const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.findMany({ select: { id: true, name: true, code: true, manufacturer: true } });
  for (const p of products) {
    await prisma.product.update({
      where: { id: p.id },
      data: { searchPinyin: searchPinyin(p.name, p.code, p.manufacturer) },
    });
  }
  console.log(`商品：${products.length} 条`);

  const customers = await prisma.customer.findMany({ select: { id: true, name: true } });
  for (const c of customers) {
    await prisma.customer.update({
      where: { id: c.id },
      data: { searchPinyin: searchPinyin(c.name) },
    });
  }
  console.log(`客户：${customers.length} 条`);

  const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true, contact: true } });
  for (const s of suppliers) {
    await prisma.supplier.update({
      where: { id: s.id },
      data: { searchPinyin: searchPinyin(s.name, s.contact) },
    });
  }
  console.log(`厂家：${suppliers.length} 条`);

  const users = await prisma.user.findMany({ select: { id: true, displayName: true } });
  for (const u of users) {
    await prisma.user.update({
      where: { id: u.id },
      data: { searchPinyin: searchPinyin(u.displayName) },
    });
  }
  console.log(`用户：${users.length} 条`);

  // 抽查：确认「张」类名字的拼音串确实写进去了
  const sample = await prisma.customer.findMany({
    where: { searchPinyin: { not: null } },
    take: 3,
    select: { name: true, searchPinyin: true },
  });
  console.log("抽样：", sample.map((s) => `${s.name} → ${s.searchPinyin}`).join(" | ") || "(无客户)");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
