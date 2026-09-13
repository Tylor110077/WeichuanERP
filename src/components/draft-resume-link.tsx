"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  emptyDraftsSnapshot,
  formatSavedAt,
  getDraftsSnapshot,
  subscribeDrafts,
  type DraftScope,
} from "@/lib/form-draft";

/**
 * 列表页头上的「继续未完成的单」入口：本地有这个类型的草稿才出现，
 * 点进去开单页会自动恢复最近那一份。没有草稿时不渲染任何东西，列表页不会多出一块空白。
 */
export function DraftResumeLink({
  scope,
  userId,
  href,
  label,
}: {
  scope: DraftScope;
  userId: number | string;
  /** 开单页地址，如 /sale-orders/new（草稿 id 会作为 ?draft= 拼上去） */
  href: string;
  /** 如「继续未完成的售卖单」 */
  label: string;
}) {
  const drafts = useSyncExternalStore(
    subscribeDrafts,
    () => getDraftsSnapshot(userId),
    emptyDraftsSnapshot
  );
  const mine = drafts.filter((d) => d.scope === scope);
  if (mine.length === 0) return null;
  const newest = mine[0];

  return (
    <Link
      href={`${href}?draft=${newest.id}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
      title="点进去会自动把这份草稿恢复出来"
    >
      {label}
      <span className="font-normal text-amber-700/80">（保存于 {formatSavedAt(newest.savedAt)}）</span>
      {mine.length > 1 && <span className="font-normal text-amber-700/80">・共 {mine.length} 份</span>}
    </Link>
  );
}
