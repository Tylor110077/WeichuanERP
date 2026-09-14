/**
 * 单据编号规则（文档 7.3）：前缀 + yyyyMMdd + 4 位序号（按日自增，唯一索引防并发重号）。
 * 序号生成与重试由各模块 action 在事务内执行（buildOrderNo 只负责拼号）。
 */

export const ORDER_NO_PREFIXES = {
  PO: "PO", // 进货单
  SO: "SO", // 售卖单
  PRF: "PRF", // 进货退货单
  PRS: "PRS", // 销售退货单
  PAY: "PAY", // 收款单
  POF: "POF", // 付款单
} as const;

export type OrderNoPrefix = (typeof ORDER_NO_PREFIXES)[keyof typeof ORDER_NO_PREFIXES];

/** 今天 yyyyMMdd（本地时区）。 */
export function todayCompact(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}${mm}${dd}`;
}

export function buildOrderNo(prefix: string, seq: number): string {
  return `${prefix}${todayCompact()}-${String(seq).padStart(4, "0")}`;
}

/** 取同前缀当日已用序号的最大值（从现有单据号尾部解析）。 */
export function extractSeq(orderNo: string): number {
  const m = /-(\d{4})$/.exec(orderNo);
  return m ? Number(m[1]) : 0;
}

/**
 * 取「下一个可用序号」：查同前缀当日单号、取最大值、+1。
 *
 * 为什么抽出来：这段逻辑本来在 5 个 action 里各抄了一份，
 * 而**进货退货那份抄错了表**（查 purchaseOrder 却按 PRF 前缀过滤），
 * 于是永远查到 0 行、单号恒为 -0001、当天第二张必然撞唯一键失败（P0-2）。
 * 现在统一走这里，并且**必须把"查哪张表"显式传进来**：
 * 传错表一眼能看出来，不再会"编得过、运行时永远查不到"。
 *
 * 调用方须在事务内调用（取号与建单必须同一事务）。
 */
export async function nextOrderSeq(
  prefix: string,
  fetchExisting: (prefixLike: string) => Promise<{ orderNo: string }[]>
): Promise<number> {
  const rows = await fetchExisting(`${prefix}${todayCompact()}-`);
  let maxSeq = 0;
  for (const r of rows) {
    const seq = extractSeq(r.orderNo);
    if (seq > maxSeq) maxSeq = seq;
  }
  return maxSeq + 1;
}
