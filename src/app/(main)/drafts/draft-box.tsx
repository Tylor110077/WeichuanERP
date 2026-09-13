"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { btnSmallPrimary } from "@/lib/ui";
import {
  DRAFT_SCOPE_LABEL,
  deleteDraft,
  emptyDraftsSnapshot,
  formatSavedAt,
  getDraftsSnapshot,
  subscribeDrafts,
  type DraftScope,
} from "@/lib/form-draft";

/** 每类草稿点进去对应的开单页 */
const NEW_HREF: Record<DraftScope, string> = {
  sale: "/sale-orders/new",
  purchase: "/purchase-orders/new",
};

/** 进货单在前、售卖单在后：先看要买什么，再看要卖什么 */
const SCOPE_ORDER: DraftScope[] = ["purchase", "sale"];

/**
 * 草稿箱：本地存的开单草稿，按「进货单 / 售卖单」两类分组列出，
 * 点「继续开单」回到对应开单页并带 ?draft=<id>，把那份草稿原样恢复出来。
 */
export function DraftBox({ userId }: { userId: number }) {
  const drafts = useSyncExternalStore(
    subscribeDrafts,
    () => getDraftsSnapshot(userId),
    emptyDraftsSnapshot
  );
  /** 删除要按两下：草稿是手打的内容，误删一次就白填了 */
  const [confirming, setConfirming] = useState<string | null>(null);

  if (drafts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-10 text-center">
        <p className="text-sm text-gray-500">还没有草稿。</p>
        <p className="mt-1 text-xs text-gray-400">
          开单时不用手动保存——填的内容会自动存成草稿，随时可以从这里接着填。
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Link href={NEW_HREF.purchase} className={btnSmallPrimary}>
            去开进货单
          </Link>
          <Link href={NEW_HREF.sale} className={btnSmallPrimary}>
            去开售卖单
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {SCOPE_ORDER.map((scope) => {
        const group = drafts.filter((d) => d.scope === scope);
        if (group.length === 0) return null;
        return (
          <section key={scope} className="space-y-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              {DRAFT_SCOPE_LABEL[scope]}草稿
              <span className="text-xs font-normal text-gray-400">{group.length} 份</span>
            </h2>
            <ul className="rounded-xl border border-gray-200 bg-white">
              {group.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-100 px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-900">
                      {d.summary.partner || `未选${scope === "sale" ? "客户" : "厂家"}`}
                    </div>
                    <div className="truncate text-xs text-gray-500">
                      {d.summary.preview || "（还没填商品）"}
                      {d.summary.lines > 0 && ` ・ 共 ${d.summary.lines} 行`}
                    </div>
                  </div>
                  <div className="w-24 shrink-0 text-sm font-semibold tabular-nums text-gray-900">
                    ¥{d.summary.amount.toFixed(2)}
                  </div>
                  <div className="w-24 shrink-0 text-xs text-gray-400">保存于 {formatSavedAt(d.savedAt)}</div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Link href={`${NEW_HREF[d.scope]}?draft=${d.id}`} className={btnSmallPrimary}>
                      继续开单
                    </Link>
                    {confirming === d.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            deleteDraft(userId, d.id);
                            setConfirming(null);
                          }}
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          确认删除
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className="text-xs text-gray-500 hover:underline"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirming(d.id)}
                        className="text-xs text-gray-400 transition hover:text-red-600 hover:underline"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
