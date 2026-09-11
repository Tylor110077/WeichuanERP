/**
 * 统一按钮样式（全站唯一样式来源）
 *
 * 尺寸只有两档，避免同功能按钮在不同页面大小不一：
 * - 常规尺寸 h-9（36px）：页面级操作（新建、保存、提交、返回、打印、作废…）
 * - 行内尺寸 h-8（32px）：表格行内、卡片内的快捷操作（新建客户/商品/组织、添加行…）
 *
 * 语义色：主=蓝底 / 次=灰描边 / 警告=橙描边 / 危险=红描边；实心仅用于二次确认。
 * 用法：import { btnPrimary } from "@/lib/ui"; → <button className={btnPrimary}>
 * 若需附加类：className={`mt-3 ${btnPrimary}`}
 */

/** 主要操作：新建、保存、提交、查询 */
export const btnPrimary =
  "inline-flex h-9 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";

/** 次要操作：返回、打印、取消、筛选、视图切换 */
export const btnSecondary =
  "inline-flex h-9 items-center justify-center rounded-md border border-gray-300 bg-white px-4 text-sm text-gray-700 transition hover:bg-gray-50";

/** 警告类操作：退货等 */
export const btnWarn =
  "inline-flex h-9 items-center justify-center rounded-md border border-orange-300 bg-white px-4 text-sm text-orange-600 transition hover:bg-orange-50";

/** 危险类操作：作废、删除、停用（描边，降低误触） */
export const btnDanger =
  "inline-flex h-9 items-center justify-center rounded-md border border-red-300 bg-white px-4 text-sm text-red-600 transition hover:bg-red-50";

/** 危险操作的二次确认按钮（实心） */
export const btnDangerSolid =
  "inline-flex h-9 items-center justify-center rounded-md bg-red-600 px-4 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";

/** 行内小按钮：表格行、卡片内的次要操作 */
export const btnSmall =
  "inline-flex h-8 items-center justify-center rounded-md border border-gray-300 bg-white px-3 text-xs text-gray-600 transition hover:bg-gray-50";

/** 行内小按钮（蓝）：快捷新建商品/客户/组织、添加商品行 */
export const btnSmallPrimary =
  "inline-flex h-8 items-center justify-center rounded-md border border-blue-300 bg-white px-3 text-xs text-blue-600 transition hover:bg-blue-50";

/** 行内小按钮（蓝底实心）：快捷新建后的确认 */
export const btnSmallSolid =
  "inline-flex h-8 items-center justify-center rounded-md bg-blue-600 px-3 text-xs font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";

/** 警告类操作的实心按钮（二次确认场景） */
export const btnWarnSolid =
  "inline-flex h-9 items-center justify-center rounded-md bg-orange-500 px-4 text-sm font-medium text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50";

/** 行内小按钮（红底）：行内删除/移除的二次确认 */
export const btnSmallDanger =
  "inline-flex h-8 items-center justify-center rounded-md bg-red-600 px-3 text-xs font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";
