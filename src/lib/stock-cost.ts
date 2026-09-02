/**
 * 库存成本计算核心（移动加权平均）。
 *
 * 正常场景（库存非负）：新金额 = 原金额 + 变动量 × 当次成本单价；新均价 = 新金额 ÷ 新数量。
 * 防御性分段（文档 7.2 / docs/细节评审.md B3）：当库存为负时入库，负数部分先按原均价
 * 回补，超出部分按新进价计入 —— 避免直套公式把成本算成 (原金额 + 每×进价) ÷ 新数量 的错误值。
 */

export interface StockState {
  qty: number;
  amount: number;
  avgCost: number;
}

/**
 * 计算库存变动后的状态。
 * @param state   变动前库存（可负——仅防御场景）
 * @param change  变动数量（正入负出）
 * @param costPrice 当次成本单价（入库=进价；出库/冲回=原 avg_cost 或入库价）
 */
export function applyStockChange(
  state: StockState,
  change: number,
  costPrice: number
): StockState {
  const newQty = state.qty + change;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const round4 = (n: number) => Math.round(n * 10000) / 10000;

  if (newQty < 0) {
    // 防御分支：变动后库存为负（正常业务禁止负库存，此分支兼容异常/历史数据）
    // 负数部分保持金额（按原均价持仓），不产生新的正持仓金额
    return { qty: newQty, amount: round2(state.amount), avgCost: state.avgCost };
  }

  if (newQty === 0) {
    // 恰好清零：库存金额归零（避免残留成本——销售卖完/作废冲回整单的场景）
    return { qty: 0, amount: 0, avgCost: 0 };
  }

  if (state.qty < 0) {
    // 冲负优先：负数部分按原均价回补，剩余按新单价
    const covered = Math.min(change, -state.qty); // 回补的负数部分
    const remainder = change - covered; // 计入新成本的剩余部分
    const amount = state.amount + covered * state.avgCost + remainder * costPrice;
    const avgCost = amount / newQty;
    return { qty: newQty, amount: round2(Math.max(amount, 0)), avgCost: round4(avgCost) };
  }

  const amount = Math.max(state.amount + change * costPrice, 0);
  const avgCost = amount / newQty;
  return { qty: newQty, amount: round2(amount), avgCost: round4(avgCost) };
}

/** Decimal(12,3) 数量四舍五入（保留 3 位），防御浮点误差。 */
export function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}
