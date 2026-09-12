import type { FocusEvent, MouseEvent } from "react";

/**
 * 聚焦/点击即全选（用于搜索框与选择器）。
 *
 * 背景：搜索框与选择器里通常会保留上一次的值（筛选词、已选客户名、已选商品名），
 * 用户点进去想搜别的，直接打字会**追加**在原值后面（"李燕芬" + "张" → "李燕芬张"），
 * 结果搜不到东西，只能先手动删掉。
 *
 * 为什么要同时处理 focus 与 click：
 * - 首次点进未聚焦的框 → 触发 focus，全选即可；
 * - 但**已经聚焦**的框再点一次不会再触发 focus（浏览器不会重复派发），
 *   这时若不处理 click，光标会落到点击位置，打字又变成追加——这正是最常见的场景。
 *
 * 用 `currentTarget.select()` 而不是清空值：用户只是想把关键词换掉，
 * 旧值仍然全选可见，误操作时不会丢失。
 */
export function selectAllOnFocus(e: FocusEvent<HTMLInputElement>) {
  e.currentTarget.select();
}

/** 已聚焦的输入框被再次点击时，同样全选 */
export function selectAllOnClick(e: MouseEvent<HTMLInputElement>) {
  e.currentTarget.select();
}

/**
 * 点击即清空（用于**筛选用的搜索框**）。
 *
 * 与全选的区别：全选只是把旧关键词选中，用户仍能看到它、打字才被替换；
 * 而用户明确希望"点一下搜索框，原来的字立刻消失"，所以这里直接把值清掉。
 *
 * 只用于纯搜索框（列表筛选、左栏搜索）。**不要用在选择器上**：
 * 选择器里那段文字代表"当前选中的是谁"，清掉会让人以为没选（值其实还在）。
 */
export function clearOnClick(e: MouseEvent<HTMLInputElement>) {
  const el = e.currentTarget;
  if (el.value) el.value = "";
}
