/**
 * 退货单的行解析规则（销售退货 / 采购退货共用）。
 *
 * 业务约定（用户明确要求）：
 * - **不填就是不退**：退货数量留空、或明确填 0，这一行整单跳过，
 *   连它的退货价都不校验（用户会只填要退的那几行，其余保持原样）；
 * - **不允许负数**：填了负数不能当成"跳过"，要拦下来报错；
 * - 没有选中原单商品的空行同样跳过（用户点了「+ 添加退货行」但没用它）。
 *
 * 单独放在这里是为了能直接跑单元测试：这几条边界条件一旦写错，
 * 表现是"该退的没退"或"没填的也退了"，都很难从界面上看出来。
 */

/** 把表单里的原始值归一成"是否等于 0 / 未填" */
export function isBlankOrZero(raw: unknown): boolean {
  if (raw == null) return true;
  const text = String(raw).trim();
  if (text === "") return true;
  const n = Number(text);
  return Number.isFinite(n) && n === 0;
}

/** 是否填了负数（要报错，不能静默跳过） */
export function isNegative(raw: unknown): boolean {
  if (raw == null) return false;
  const text = String(raw).trim();
  if (text === "") return false;
  const n = Number(text);
  return Number.isFinite(n) && n < 0;
}

export interface ParsedReturnRows {
  /** 交给 zod 校验的行（只含真正要退的行 + 需要报错的非法行） */
  items: { orderItemId: unknown; quantity: unknown; unitPrice: unknown }[];
  /** 因「未填/填 0/空行」被跳过的行数，用于提示"其余行未退" */
  skipped: number;
}

/**
 * 从 FormData 里按 `item_${i}_*` 取出退货行。
 * 一直读到位号不存在为止（行的增删在客户端按索引重排）。
 */
export function parseReturnRows(formData: FormData): ParsedReturnRows {
  const items: ParsedReturnRows["items"] = [];
  let skipped = 0;
  for (let i = 0; formData.has(`item_${i}_orderItemId`); i++) {
    const orderItemId = formData.get(`item_${i}_orderItemId`);
    const quantity = formData.get(`item_${i}_quantity`);
    const unitPrice = formData.get(`item_${i}_unitPrice`);

    const noItem = orderItemId == null || String(orderItemId).trim() === "";
    // 空行、未填数量、填 0：都算"这一行不退"。负数除外——那是要报错的。
    if (noItem || (isBlankOrZero(quantity) && !isNegative(quantity))) {
      skipped++;
      continue;
    }
    items.push({ orderItemId, quantity, unitPrice });
  }
  return { items, skipped };
}
