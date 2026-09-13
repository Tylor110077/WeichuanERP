/**
 * 收付款的中文说法：单据详情、厂家对账、财务流水都要用，集中一份避免各写各的。
 */

export const PAYMENT_DIRECTION_LABELS: Record<string, string> = {
  receipt: "收款",
  payment: "付款",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "现金",
  bank: "银行转账",
  wechat: "微信",
  alipay: "支付宝",
  other: "其他",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  confirmed: "已登记",
  voided: "已作废",
};
