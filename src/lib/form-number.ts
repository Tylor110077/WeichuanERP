import { z } from "zod";

/**
 * 表单数字字段的统一处理。
 *
 * 背景（踩过的坑）：`z.coerce.number()` 会把空字符串当 0、把 undefined 当 NaN。
 * 而 `.optional()` 加在 `z.preprocess()` **外面**时，Zod 看到的仍是原始输入（空串），
 * 会继续走进内层 schema，于是 undefined 被 coerce 成 NaN，报出英文的
 * 「Invalid input: expected number, received NaN」——用户完全看不懂。
 * 所以这里统一把 `.optional()` 放在**内层**，并给每个字段配中文提示。
 */

/** 空串 / null / undefined 一律视为「未填写」 */
export function emptyToUndefined(v: unknown) {
  return v === "" || v == null ? undefined : v;
}

/**
 * 可空数字：留空 → undefined（用于「留空＝按默认逻辑处理」的字段，如销售开单的「用库存」）。
 */
export function optionalNumber(opts: {
  /** 非法输入时的提示，如「用库存必须是数字」 */
  invalid: string;
  min?: number;
  max?: number;
  minMessage?: string;
  maxMessage?: string;
}) {
  let inner = z.coerce.number({ error: opts.invalid });
  if (opts.min != null) inner = inner.min(opts.min, opts.minMessage ?? opts.invalid);
  if (opts.max != null) inner = inner.max(opts.max, opts.maxMessage ?? opts.invalid);
  return z.preprocess(emptyToUndefined, inner.optional());
}

/**
 * 必填数字：留空/非法都会得到同一个中文提示（如「请填写数量」），不再泄漏英文报错。
 */
export function requiredNumber(opts: {
  /** 留空或非法时的提示 */
  invalid: string;
  min?: number;
  max?: number;
  minMessage?: string;
  maxMessage?: string;
}) {
  let inner = z.coerce.number({ error: opts.invalid });
  if (opts.min != null) inner = inner.min(opts.min, opts.minMessage ?? opts.invalid);
  if (opts.max != null) inner = inner.max(opts.max, opts.maxMessage ?? opts.invalid);
  // 先预处理再走内层必填 schema：空串会落到 invalid 提示上
  return z.preprocess((v) => (v === "" || v == null ? undefined : v), inner);
}

const ITEM_FIELD_LABELS: Record<string, string> = {
  productId: "商品",
  quantity: "数量",
  unitPrice: "售价",
  supplyPrice: "进价",
  extraQty: "多补",
  stockUsed: "用库存",
  supplierId: "补货厂家",
  remark: "备注",
};

/**
 * 把 Zod 报错翻译成「第几行、哪个字段、什么问题」。
 * 例：items.0.stockUsed → 「第 1 行「用库存」：用库存必须是数字」
 */
export function describeZodIssue(
  issue: { path: PropertyKey[]; message: string },
  /** 场景内的字段名覆盖（如进货单的 unitPrice 叫「进价」）；其余字段沿用默认标签 */
  labels: Record<string, string> = {}
): string {
  const [head, index, field] = issue.path.map(String);
  if (head === "items" && index != null && Number.isFinite(Number(index))) {
    const row = `第 ${Number(index) + 1} 行`;
    const label = field ? (labels[field] ?? ITEM_FIELD_LABELS[field] ?? field) : "";
    return label ? `${row}「${label}」：${issue.message}` : `${row}：${issue.message}`;
  }
  return issue.message;
}

/** 表单报错的第一条，翻译成中文描述 */
export function firstIssueMessage(
  error: z.ZodError,
  labels?: Record<string, string>
): string {
  const issue = error.issues[0];
  if (!issue) return "输入有误";
  return describeZodIssue(issue, labels);
}
