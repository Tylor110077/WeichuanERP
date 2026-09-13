import { PrismaClient } from "@prisma/client";
import { searchPinyin } from "./pinyin";

/**
 * 需要维护 `search_pinyin` 的模型：写这些字段时自动重算拼音串。
 * 加新模型时在这里加一行即可（前提：库里已有该列）。
 */
const SEARCH_PINYIN_FIELDS: Record<string, string[]> = {
  // 键用小写；钩子传进来的是 PascalCase（"Customer"），比对时统一转小写（见 withSearchPinyin）
  customer: ["name"],
  supplier: ["name", "contact"],
  product: ["name", "code", "manufacturer"],
  user: ["displayName"],
};

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 写入前补齐 `search_pinyin`：只有本次 data 带了参与搜索的字段才重算，
 * 其余写入（改库存、改价格、改状态、记登录时间）原样放行，不白算一遍拼音。
 */
function withSearchPinyin(model: string, args: unknown): unknown {
  // Prisma 钩子给的是 PascalCase 的模型名（"Customer"），这里统一小写再查表
  const fields = SEARCH_PINYIN_FIELDS[model.toLowerCase()];
  if (!fields || !isRecord(args)) return args;

  const touch = (data: unknown): unknown => {
    if (!isRecord(data)) return data;
    if (!fields.some((f) => typeof data[f] === "string")) return data;
    const values = fields.map((f) => (typeof data[f] === "string" ? (data[f] as string) : null));
    return { ...data, searchPinyin: searchPinyin(...values) };
  };

  const next: AnyRecord = { ...args };
  if ("data" in next) next.data = touch(next.data);
  // upsert 的 create / update 两半都要照顾到
  if (isRecord(next.create)) next.create = touch(next.create);
  if (isRecord(next.update)) next.update = touch(next.update);
  return next;
}

const base = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
}).$extends({
  name: "search-pinyin",
  query: {
    $allModels: {
      async $allOperations({ model, args, query }) {
        return query(withSearchPinyin(model ?? "", args) as typeof args);
      },
    },
  },
});

type ExtendedPrisma = typeof base;

/**
 * 事务里拿到的客户端类型。
 * 扩展过 client 之后不能再写 `Prisma.TransactionClient`：那样 `prisma.$transaction(async (tx) => …)`
 * 的 tx 传不进以 TransactionClient 标注的辅助函数（扩展类型不是它的子类型）。
 */
export type TxClient = Omit<
  ExtendedPrisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

const globalForPrisma = globalThis as unknown as { prisma?: ExtendedPrisma };

export const prisma: ExtendedPrisma = globalForPrisma.prisma ?? base;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
