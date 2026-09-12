"use client";

import type { InputHTMLAttributes } from "react";

/**
 * 搜索输入框（聚焦即全选）。
 *
 * 为什么需要这个组件：筛选页大多是**服务端组件**，不能给元素直接传 onFocus，
 * 而"点开搜索框想改关键词"时必须先全选——否则输入会追加在旧值后面
 * （"2026" + "李" → "2026李"），用户只能先手动删掉再打字。
 *
 * 用法与原生 input 一致（name / defaultValue / placeholder / className / id 都能透传）。
 */
export function SearchInput({
  type = "search",
  autoComplete = "off",
  onFocus,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      autoComplete={autoComplete}
      {...rest}
      onFocus={(e) => {
        e.currentTarget.select();
        onFocus?.(e);
      }}
      // 已聚焦的框再点一次不会再触发 focus，这里补上，避免打字变成追加
      onClick={(e) => e.currentTarget.select()}
    />
  );
}
