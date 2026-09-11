/**
 * 写操作反馈：成功/失败提示的唯一来源。
 *
 * 统一「位置 + 版式」：紧挨触发它的按钮或表单之后，不弹 toast、不跳顶部，
 * 避免同一页面上出现 text-xs / text-sm 两种字号和三种颜色的混搭。
 *
 * 用法：
 *   <FormAlert kind="error" text={state.error} />
 *   <FormStateAlert state={state} />          // 由 { error, ok } 自动判断
 *   <FormAlert kind="ok" text="已保存" compact />  // 表格行内 / 窄卡片
 */
import type { ReactNode } from "react";

export type AlertKind = "error" | "ok";

const tone: Record<AlertKind, string> = {
  error: "border-red-200 bg-red-50 text-red-700",
  ok: "border-green-200 bg-green-50 text-green-700",
};

const iconPath: Record<AlertKind, ReactNode> = {
  error: <path d="M12 8v5M12 16.5v.5M12 3l9 18H3z" strokeLinejoin="round" strokeLinecap="round" />,
  ok: <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />,
};

export function FormAlert({
  kind,
  text,
  compact,
  className,
}: {
  kind: AlertKind;
  text: string;
  /** 表格行内、窄卡片等紧凑场景（更小字号与内边距） */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`flex items-start gap-1.5 rounded-lg border ${tone[kind]} ${
        compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm"
      } ${className ?? ""}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className={`${compact ? "h-3.5 w-3.5" : "h-4 w-4"} mt-px shrink-0`}
        aria-hidden
      >
        {iconPath[kind]}
      </svg>
      <span className="min-w-0 flex-1 whitespace-pre-wrap">{text}</span>
    </div>
  );
}

/** 由 useActionState 的返回值渲染：优先展示错误，其次是成功；都为空则什么都不渲染。 */
export function FormStateAlert({
  state,
  compact,
  className,
}: {
  state: { error?: string; ok?: string } | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  if (!state) return null;
  if (state.error) return <FormAlert kind="error" text={state.error} compact={compact} className={className} />;
  if (state.ok) return <FormAlert kind="ok" text={state.ok} compact={compact} className={className} />;
  return null;
}
