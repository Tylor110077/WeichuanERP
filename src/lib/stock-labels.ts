/**
 * 库存流水类型的中文说法。
 *
 * 单独放一份：流水页要用它做标签（那里还带一套徽标配色），CLI 也要用同一套文字。
 * 文字必须**唯一**——两处各写一份，出现"进货入库/采购入库"这种不一致时，
 * 对账的人会以为是两回事。
 */

export const STOCK_BIZ_TYPE_LABELS: Record<string, string> = {
  purchase_in: "进货入库",
  sale_out: "销售出库",
  purchase_return_out: "进货退货",
  sale_return_in: "销售退货",
  void_reverse: "作废冲回",
};

export const STOCK_BIZ_TYPES = Object.keys(STOCK_BIZ_TYPE_LABELS);
