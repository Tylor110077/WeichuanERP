"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { draftKey, formatSavedAt, readDraft } from "@/lib/form-draft";

/**
 * 草稿只存在浏览器本地，所以走 useSyncExternalStore 读：
 * 服务端快照给 null（服务端渲染时本来也看不到草稿）、挂载后再读真实值，
 * 既不会 hydration 不一致，也不用在 effect 里 setState。
 */
const subscribe = () => () => {};

/**
 * 列表页头上的「继续未完成的开单」入口：本地有草稿才出现，点进去开单页会自动恢复。
 * 没有草稿时不渲染任何东西，列表页不会多出一块空白。
 */
export function DraftResumeLink({
  scope,
  userId,
  href,
  label,
}: {
  scope: string;
  userId: number | string;
  href: string;
  /** 如「继续未完成的售卖单」 */
  label: string;
}) {
  const savedAt = useSyncExternalStore(
    subscribe,
    () => readDraft<unknown>(draftKey(scope, userId))?.savedAt ?? null,
    () => null
  );

  if (savedAt == null) return null;

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
      title="点进去会自动把上次填的内容恢复出来"
    >
      {label}
      <span className="font-normal text-amber-700/80">（保存于 {formatSavedAt(savedAt)}）</span>
    </Link>
  );
}
