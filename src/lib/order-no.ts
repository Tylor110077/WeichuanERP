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
