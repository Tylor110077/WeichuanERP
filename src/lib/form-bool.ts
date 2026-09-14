import { z } from "zod";

/**
 * 布尔字段的统一处理（与 lib/form-number.ts 是同一类坑的另一半）。
 *
 * 踩过的坑：`z.coerce.boolean()` 走的是 JS 的 `Boolean()`——**非空字符串一律为 true**，
 * 于是 `--enabled false` 被当成"启用"、`--allow-duplicate=false` 也被当成"允许"。
 * 命令行里显式写 `false` 是最自然的用法，必须按字面理解。
 *
 * 用法：把 `z.coerce.boolean()` 换成 `zBoolean()`，其余不变。
 */

const FALSE_TEXT = new Set(["false", "0", "no", "off", "n", "否", "不"]);
const TRUE_TEXT = new Set(["true", "1", "yes", "on", "y", "是"]);

export function zBoolean(invalid = "只能是 true 或 false") {
  return z.preprocess((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (FALSE_TEXT.has(s)) return false;
      if (TRUE_TEXT.has(s)) return true;
    }
    // 其它（含空串、undefined、乱七八糟的字符串）原样交给内层报错，别猜
    return v;
  }, z.boolean({ error: invalid }));
}
