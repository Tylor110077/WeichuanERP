"use client";

import { useState } from "react";

/**
 * 行内二次确认按钮（用于列表行里的停用/启用/删除）。
 *
 * 两个作用：
 * 1. 防误触：第一次点击只是"待确认"，再点一次才真正提交表单；
 * 2. 减 DOM：未进入待确认状态时**不渲染 form 与隐藏域**——
 *    主数据列表原先每行固定渲染 2 个 form，商品页首屏因此有 16 个表单、83 个输入框。
 */
export function RowAction({
  action,
  hidden,
  label,
  confirmLabel,
  className = "text-xs text-red-600 hover:underline",
  disabled,
}: {
  action: (formData: FormData) => void | Promise<void>;
  /** 随表单提交的隐藏字段（通常是 { id }） */
  hidden: Record<string, string | number>;
  label: string;
  confirmLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setArmed(true)}
        className={`${className} disabled:opacity-50`}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <form action={action}>
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={String(v)} />
        ))}
        <button type="submit" disabled={disabled} className={`${className} disabled:opacity-50`}>
          {confirmLabel}
        </button>
      </form>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="text-xs text-gray-500 hover:underline"
      >
        取消
      </button>
    </span>
  );
}
