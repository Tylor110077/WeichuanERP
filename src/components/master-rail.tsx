"use client";

/**
 * MasterRail —— 「主从同屏」布局的左栏（分类轴）。
 *
 * 典型的用法是左侧一列分类（如「厂家」「客户组织」，厂家可能有几百项），
 * 右侧同屏展示所选分类对应的明细列表。因此左栏需要「可搜索」且「可滚动」，
 * 否则项目一多就没法用。
 *
 * 约定：
 * - 搜索是纯客户端过滤（label 转小写后做包含匹配，输入即筛，不防抖），
 *   只影响列表显示，不改变当前选中项：选中项即使被过滤掉也照常保持选中态。
 * - 选中态通过 aria-current="page" 暴露，便于无障碍工具与测试定位。
 * - 每项的 href 全部由调用方拼好（通常会保留右侧列表当前的搜索词与页码），
 *   本组件不参与 URL 构造，只负责渲染。
 * - 「全部」项固定在最上方，「未分配/未填写」项固定在最下方，二者都不参与搜索过滤。
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import type { JSX } from "react";

export interface RailItem {
  /** 唯一键，React key 用 */
  key: string;
  /** 显示名 */
  label: string;
  /** 数量徽标，如 12 */
  count: number;
  /** 完整链接（由调用方拼好，通常保留右侧列表当前的搜索词与页码） */
  href: string;
  /** 是否为当前选中项 */
  active: boolean;
}

/** 单行样式：选中项蓝底加粗，未选中项灰字 + 浅灰 hover */
function railItemClass(active: boolean): string {
  return [
    "flex items-center justify-between gap-2 px-3 py-2 text-sm",
    active
      ? "bg-blue-50 font-medium text-blue-700"
      : "text-gray-700 hover:bg-gray-50",
  ].join(" ");
}

/** 右侧数量徽标，固定宽度不随名字换行挤压 */
function RailCount({ count }: { count: number }): JSX.Element {
  return (
    <span className="shrink-0 text-xs tabular-nums text-gray-400">
      {count}
    </span>
  );
}

export function MasterRail({
  title,
  items,
  searchPlaceholder = "搜索…",
  emptyText = "无匹配项",
  allLabel,
  allHref,
  allCount,
  allActive = false,
  unassigned,
  className,
}: {
  /** 左栏标题，如「厂家」 */
  title: string;
  /** 可选项列表（不含「全部」） */
  items: RailItem[];
  searchPlaceholder?: string;
  /** 搜索后无匹配时的文案，默认「无匹配项」 */
  emptyText?: string;
  /** 「全部」项文案，如「全部厂家」；不传则不渲染该项 */
  allLabel?: string;
  allHref?: string;
  allCount?: number;
  allActive?: boolean;
  /** 可选的"未分配/未填写"项，固定显示在列表最下方（如「未填厂家」「未分组」） */
  unassigned?: { label: string; count: number; href: string; active: boolean };
  className?: string;
}): JSX.Element {
  const [keyword, setKeyword] = useState("");

  // 输入即筛：关键词为空时显示全部；只过滤列表，不动选中项。
  const visibleItems = useMemo(() => {
    const kw = keyword.toLowerCase();
    if (!kw) return items;
    return items.filter((item) => item.label.toLowerCase().includes(kw));
  }, [items, keyword]);

  return (
    <div
      className={["rounded-xl border border-gray-200 bg-white", className]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="px-4 py-3 text-sm font-semibold text-gray-900">
        {title}
      </div>

      <div className="px-3 py-2">
        <input
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={title}
          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
      </div>

      {/* 「全部」固定在最上方，不参与搜索过滤 */}
      {allLabel ? (
        <div className="border-b border-gray-100">
          <Link
            href={allHref ?? "#"}
            aria-current={allActive ? "page" : undefined}
            className={railItemClass(allActive)}
          >
            <span className="truncate">{allLabel}</span>
            {typeof allCount === "number" ? (
              <RailCount count={allCount} />
            ) : null}
          </Link>
        </div>
      ) : null}

      <div className="max-h-[28rem] overflow-y-auto">
        {visibleItems.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-gray-400">
            {emptyText}
          </p>
        ) : (
          visibleItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={railItemClass(item.active)}
            >
              <span className="truncate">{item.label}</span>
              <RailCount count={item.count} />
            </Link>
          ))
        )}
      </div>

      {/* 「未分配/未填写」固定在最下方，不参与搜索过滤（count 为 0 也照常显示） */}
      {unassigned ? (
        <div className="border-t border-gray-100">
          <Link
            href={unassigned.href}
            aria-current={unassigned.active ? "page" : undefined}
            className={railItemClass(unassigned.active)}
          >
            <span className="truncate">{unassigned.label}</span>
            <RailCount count={unassigned.count} />
          </Link>
        </div>
      ) : null}
    </div>
  );
}
