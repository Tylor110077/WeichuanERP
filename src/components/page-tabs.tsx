/**
 * 页面级页签（PageTabs）
 *
 * 用途：当一个页面里存在多个互斥的工作区（既有"查看类"视图，也有"维护类"表单/列表）时，
 * 用一条页签行代替多条横向长条折叠区，避免纵向堆叠、让用户一眼看清页面共有哪几块内容。
 *
 * 实现：纯链接式、服务端渲染（不加 "use client"，零客户端 JS）。
 * 点击页签等价于切换 URL 上的 ?tab= 参数，因此可分享链接、可前进/后退，
 * 并且 href 由调用方拼好，从而在切换页签时保留当前筛选参数。
 */
import type { JSX } from "react";
import Link from "next/link";

import { segActive, segIdle } from "@/lib/ui";

export interface PageTab {
  /** URL 里的 tab 值，如 "manufacturers" */
  key: string;
  label: string;
  /** 可选数量徽标，如 2 或 "1 · 1"；不传则不显示 */
  count?: number | string;
  /** 完整链接（由调用方拼好，通常保留当前筛选参数） */
  href: string;
  /** 可选说明，作为 title 属性（鼠标悬停提示） */
  hint?: string;
}

export function PageTabs({
  tabs,
  current,
  className,
}: {
  tabs: PageTab[];
  current: string;
  className?: string;
}): JSX.Element {
  return (
    <nav
      className={
        className
          ? `flex flex-wrap items-center gap-2 ${className}`
          : "flex flex-wrap items-center gap-2"
      }
    >
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            title={tab.hint}
            aria-current={active ? "page" : undefined}
            className={`px-3 py-1.5 text-sm ${active ? segActive : segIdle}`}
          >
            {tab.label}
            {tab.count === undefined || tab.count === null ? null : (
              <span
                className={`ml-1.5 text-xs tabular-nums ${
                  active ? "text-white/75" : "text-gray-500"
                }`}
              >
                {tab.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * 从 searchParams 里解析页签：只接受白名单内的值，否则回落到 fallback。
 * @example const tab = resolveTab(TABS.map(t => t.key), params.tab, "products");
 */
export function resolveTab(
  valid: readonly string[],
  value: string | undefined,
  fallback: string
): string {
  if (!value) return fallback;
  return valid.includes(value) ? value : fallback;
}
