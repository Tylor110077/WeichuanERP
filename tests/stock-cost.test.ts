import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStockChange } from "../src/lib/stock-cost";

test("正常入库：移动加权平均", () => {
  // 0 库存入 20 件 @10
  let s = applyStockChange({ qty: 0, amount: 0, avgCost: 0 }, 20, 10);
  assert.equal(s.qty, 20);
  assert.equal(s.amount, 200);
  assert.equal(s.avgCost, 10);

  // 再入 30 件 @14 → (200 + 420) / 50 = 12.4
  s = applyStockChange(s, 30, 14);
  assert.equal(s.qty, 50);
  assert.equal(s.amount, 620);
  assert.equal(s.avgCost, 12.4);
});

test("正常销售：按均价扣减", () => {
  // 库存 50 @12.4，卖出 20 → 金额 620 - 20×12.4 = 372，均价不变
  const s = applyStockChange({ qty: 50, amount: 620, avgCost: 12.4 }, -20, 12.4);
  assert.equal(s.qty, 30);
  assert.equal(s.amount, 372);
  assert.equal(s.avgCost, 12.4);
});

test("防御分支：负库存入库按冲负优先（文档 B3 示例）", () => {
  // 库存 -10（均价 0），入 20 件 @10
  const s = applyStockChange({ qty: -10, amount: 0, avgCost: 0 }, 20, 10);
  // 回补 -10 @0（成本不变），剩余 10 @10 → 金额 100，均价 10
  assert.equal(s.qty, 10);
  assert.equal(s.amount, 100);
  assert.equal(s.avgCost, 10);
});

test("防御分支：负库存入库均价非零时", () => {
  // 库存 -5（均价 8，持仓金额 -40），入 10 件 @10
  // → 回补 -5@8（金额回到 0），剩余 5@10（50）→ 金额 50，均价 10
  const s = applyStockChange({ qty: -5, amount: -40, avgCost: 8 }, 10, 10);
  assert.equal(s.qty, 5);
  assert.equal(s.amount, 50);
  assert.equal(s.avgCost, 10);
});

test("防御分支：变动后仍为负数，金额保持", () => {
  const s = applyStockChange({ qty: 3, amount: 30, avgCost: 10 }, -5, 10);
  assert.equal(s.qty, -2);
  assert.equal(s.amount, 30);
  assert.equal(s.avgCost, 10);
});

test("恰好清零：金额必须归零（卖完/整单作废冲回）", () => {
  // 库存 20 @10，卖出 20 → 0 件，金额归零
  const sold = applyStockChange({ qty: 20, amount: 200, avgCost: 10 }, -20, 10);
  assert.equal(sold.qty, 0);
  assert.equal(sold.amount, 0);
  assert.equal(sold.avgCost, 0);
  // 库存 20 @10，作废冲回 20 → 0 件，金额归零
  const voided = applyStockChange({ qty: 20, amount: 200, avgCost: 10 }, -20, 10);
  assert.equal(voided.amount, 0);
});

test("四舍五入：不均分母运算到 4 位", () => {
  // 入 1 件 @1，再入 2 件 @2 → (1+4)/3 = 1.6667
  let s = applyStockChange({ qty: 0, amount: 0, avgCost: 0 }, 1, 1);
  s = applyStockChange(s, 2, 2);
  assert.equal(s.amount, 5);
  assert.equal(s.avgCost, 1.6667);
});
