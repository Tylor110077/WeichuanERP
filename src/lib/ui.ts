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

/** 正向确认类操作（确认入库、导出）：绿色实心 */
export const btnSuccess =
  "inline-flex h-9 items-center justify-center rounded-md bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50";

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

/**
 * 状态标签（小胶囊）：语义固定，避免同一含义在不同页面换色
 * - 绿=已完成/已结清/启用；橙=待处理/预警；灰=作废/停用/中性；红=异常
 * 用法：<span className={badgeOk}>已结清</span>
 *
 * 一律带 whitespace-nowrap：表格列被挤窄时，「已入库」这类三字徽标会被拆成竖排三行
 * （曾出现 20×58 的徽标、行高 141px）。约定是——不要挤压单个小徽标，
 * 让同一行里能换行的文字去换行、行变高即可。
 */
export const badgeOk = "whitespace-nowrap rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700";
export const badgePending = "whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700";
export const badgeMuted = "whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600";
export const badgeDanger = "whitespace-nowrap rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700";
/** 信息类标签（厂家、分类等中性标注） */
export const badgeInfo = "whitespace-nowrap rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700";

/** 数值语义色：正向（利润、已收）=绿，负向（未收、欠款）=红，待处理=橙 */
export const textPositive = "text-green-700";
export const textNegative = "text-red-600";
export const textPending = "text-amber-700";

/** 行内小标注（厂家等）：紧凑方形，区别于状态胶囊 */
export const tagInfo = "whitespace-nowrap rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700";
export const tagPending = "whitespace-nowrap rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600";

/** 分段控件（视图切换、报表页签）选中态 / 未选中态 */
export const segActive = "rounded-md bg-blue-600 text-white";
export const segIdle = "rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900";

/**
 * 表单控件统一样式（输入框 / 下拉）。
 *
 * 为什么必须统一：筛选栏里各种控件并排，只要**高度**不一致（例如 px-3 py-2 vs px-2 py-1.5
 * 差 4px），按底部对齐后顶部就错开，看起来就是"没对齐"。
 * 这里用固定的 h-9（36px）锁住高度，与 btnSecondary 等按钮同高，一行里所有控件上下都齐平。
 *
 * 用法：<input className={inputBase} />、<select className={selectCls} />
 * 需要宽度时在后面追加（如 `${inputBase} w-40`）。
 */
export const inputBase =
  "h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 transition focus:border-blue-400 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400";

/** 下拉框：右侧留出箭头空间 */
export const selectCls = `${inputBase} pr-7`;
