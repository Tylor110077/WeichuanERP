/**
 * 开单行里字段列的公共零件（销售开单与进货开单共用）。
 *
 * 每列都是「标签 / 值 / 提示」三层：提示层**恒占一行高度**，
 * 所以某列有没有提示都不会把相邻列的数值顶得参差不齐（这是踩过多次的坑）。
 * 只读值用 readOnlyValue，与输入框同高同内边距，同行里"能填的"和"只看的"基线才对得齐。
 * 分组之间用 RowDivider：一条自适应整行高度的竖线。
 */

export function RowField({
  label,
  required,
  hint,
  hintTitle,
  hintClass = "text-gray-400",
  className = "",
  children,
}: {
  label: string;
  required?: boolean;
  /** 值下方的一行小字（如均价、上次价）；不传也占位，保证各列高度一致 */
  hint?: React.ReactNode;
  hintTitle?: string;
  hintClass?: string;
  /** 列宽，如 w-[7rem] */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-field={label} className={`shrink-0 ${className}`}>
      <span className="block truncate text-[11px] leading-4 text-gray-500">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
      <div className={`mt-1 h-4 truncate text-[11px] leading-4 ${hintClass}`} title={hintTitle}>
        {hint}
      </div>
    </div>
  );
}

/** 字段分组之间的竖线：高度跟着整行自适应 */
export function RowDivider() {
  return <div className="mx-1 w-px shrink-0 self-stretch bg-gray-200" />;
}

/** 只读数值：与输入框同高同内边距，保证同行里"能填的"和"只看的"数值基线一致 */
export const readOnlyValue = "flex h-9 items-center px-2 tabular-nums";
