"use client";

import type { KeyboardEvent, ReactNode } from "react";

/**
 * 筛选表单：**选完即筛**（下拉/日期变化立即提交），文本输入**回车即筛**，
 * 同时保留「查询/筛选」按钮作为可见兜底。
 *
 * 仅用于 GET 提交的筛选表单；server action 的提交表单请继续用原生 <form>。
 */
export function FilterForm({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <form
      className={className}
      onChange={(e) => {
        // form 上的 change 事件目标类型被推断为 form 本身，这里按实际控件收窄
        const el = e.target as unknown as HTMLInputElement;
        const isSelect = el.tagName === "SELECT";
        const isDate = el.type === "date";
        // 选择类字段变化即提交；文本输入等用户回车
        if (isSelect || isDate) {
          e.currentTarget.requestSubmit();
        }
      }}
      onKeyDown={(e: KeyboardEvent<HTMLFormElement>) => {
        const el = e.target as HTMLElement;
        if (el.tagName === "INPUT" && e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.requestSubmit();
        }
      }}
    >
      {children}
    </form>
  );
}
