"use client";

import Link from "next/link";
import { useState } from "react";
import { formatSavedAt } from "@/lib/form-draft";

/**
 * 开单页顶部的草稿状态。
 *
 * - 刚恢复了草稿：蓝条 + 保存时间 + 「清空草稿并重新开单」，让用户知道表单里为什么已经有内容；
 * - 平时：一行小灰字「草稿已自动保存 14:32」，回答"我填的东西会不会丢"。
 * 两者都带「全部草稿」入口，方便跳到草稿箱换一份接着填。
 */
export function DraftBanner({
  restoredAt,
  savedAt,
  onDiscard,
  onStartNew,
}: {
  /** 恢复的草稿保存时间；没恢复就是 null */
  restoredAt: number | null;
  /** 最近一次自动保存时间；还没存过是 null */
  savedAt: number | null;
  /** 删掉这份草稿并重新开单 */
  onDiscard: () => void;
  /** 这份草稿留在草稿箱，另开一张新的 */
  onStartNew?: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);

  if (restoredAt != null && !dismissed) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
        <span className="font-medium">已恢复上次未完成的草稿（保存于 {formatSavedAt(restoredAt)}）</span>
        <span className="text-blue-700/80">接着填就行。</span>
        <Link href="/drafts" className="shrink-0 text-blue-700 underline decoration-dotted underline-offset-2 hover:decoration-solid">
          全部草稿
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {onStartNew && (
            <button
              type="button"
              onClick={onStartNew}
              title="这份草稿留在草稿箱里，另开一张新的空白单"
              className="rounded border border-blue-300 bg-white px-2 py-0.5 font-medium text-blue-700 transition hover:bg-blue-100"
            >
              另开一张（保留这份）
            </button>
          )}
          <button
            type="button"
            onClick={onDiscard}
            title="删除这份草稿，重新开始填"
            className="rounded border border-blue-300 bg-white px-2 py-0.5 font-medium text-blue-700 transition hover:bg-blue-100"
          >
            删除这份草稿
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="收起提示"
            className="rounded px-1 text-blue-400 transition hover:bg-blue-100 hover:text-blue-700"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  if (savedAt != null) {
    return (
      <p className="flex flex-wrap items-center justify-end gap-x-2 text-[11px] text-gray-400">
        <span>草稿已自动保存 {formatSavedAt(savedAt)}（离开页面再回来可以接着填）</span>
        <Link href="/drafts" className="text-blue-600 underline decoration-dotted underline-offset-2 hover:decoration-solid">
          全部草稿
        </Link>
      </p>
    );
  }

  return null;
}
