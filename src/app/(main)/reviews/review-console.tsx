"use client";

import { useActionState, useState } from "react";
import { btnDanger, btnPrimary, btnSecondary, inputBase } from "@/lib/ui";
import { FormStateAlert } from "@/components/form-alert";
import { reviewAction, type ReviewActionState } from "./actions";

export interface ReviewRow {
  docType: string;
  docTypeLabel: string;
  docId: number;
  docNo: string;
  amount: string;
  createdAt: string;
  actorKind: "human" | "agent";
  agentRunId: string | null;
  reviewStatus: string;
  version: number;
  revisionOf: number | null;
  needsVoid: boolean;
}

/**
 * 审核台的操作区：勾选 + 一次填意见 + 三个动作（一个表单，服务端按 __kind 分派）。
 *
 * 为什么是"勾选 + 批量"：一次需求 = 一个 agentRunId = 一批单据，
 * 人应该一次审完一批，而不是逐单点。
 *
 * 驳回按钮旁特意标注"只打标、不撤账"——这是"立刻生效、留痕在后"设计里
 * 最容易被误解的一点：被驳回的单据**已经改过库存和成本**，必须另行作废才能退出账。
 */
export function ReviewConsole({ rows }: { rows: ReviewRow[] }) {
  const [state, action, pending] = useActionState<ReviewActionState, FormData>(reviewAction, null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const keyOf = (r: ReviewRow) => `${r.docType}|${r.docId}`;
  const toggle = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const allChecked = rows.length > 0 && selected.size === rows.length;

  return (
    <form action={action} className="space-y-3">
      {/* 勾选的行以隐藏域提交（服务端的 key 形如 "sale_order|20028"） */}
      {[...selected].map((k) => (
        <input key={k} type="hidden" name="docs" value={k} />
      ))}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map(keyOf)))}
            className="h-4 w-4"
          />
          全选（{selected.size}/{rows.length}）
        </label>
        <input
          name="notes"
          placeholder="审核意见（驳回时必填，例如：数量不对，请改成 3）"
          className={`${inputBase} min-w-64 flex-1`}
          maxLength={1000}
        />
        <button type="submit" name="__kind" value="approve" disabled={pending || selected.size === 0} className={btnPrimary}>
          通过{selected.size > 0 ? ` ${selected.size}` : ""}
        </button>
        <button
          type="submit"
          name="__kind"
          value="reject"
          disabled={pending || selected.size === 0}
          className={btnDanger}
          title="驳回只打标、不撤账：这些单仍已生效，需另行作废"
        >
          驳回{selected.size > 0 ? ` ${selected.size}` : ""}
        </button>
        <button type="submit" name="__kind" value="comment" disabled={pending || selected.size === 0} className={btnSecondary}>
          仅留言
        </button>
      </div>

      <FormStateAlert state={state} />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-12 text-center text-sm text-gray-400">
          没有待处理的单据。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[60rem] divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="w-10 px-3 py-3 font-medium">选</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">类型</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">单号</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium tabular-nums">金额</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">开单时间</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">来源批次</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">版本</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => {
                const k = keyOf(r);
                return (
                  <tr key={k} className={selected.has(k) ? "bg-blue-50/50" : undefined}>
                    <td className="px-3 py-2.5">
                      <input type="checkbox" checked={selected.has(k)} onChange={() => toggle(k)} className="h-4 w-4" />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{r.docTypeLabel}</span>
                      {r.actorKind === "agent" && (
                        <span className="ml-1.5 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700" title={`Agent 代做（批次 ${r.agentRunId ?? "未标"}）`}>
                          🤖 Agent
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <a href={hrefOf(r)} className="text-blue-600 hover:underline">
                        {r.docNo}
                      </a>
                      {r.reviewStatus === "pending_review" && (
                        <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">待审核</span>
                      )}
                      {r.needsVoid && (
                        <span
                          className="ml-1.5 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700"
                          title="已驳回但仍占着库存/成本账，需要作废"
                        >
                          待作废
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">¥{r.amount}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-gray-600">{r.createdAt}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-gray-500">{r.agentRunId ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-gray-600">
                      v{r.version}
                      {r.revisionOf != null && <span className="ml-1 text-xs text-gray-400">（改自 #{r.revisionOf}）</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </form>
  );
}

function hrefOf(r: ReviewRow): string {
  if (r.docType === "sale_order") return `/sale-orders/${r.docId}`;
  if (r.docType === "purchase_order") return `/purchase-orders/${r.docId}`;
  if (r.docType === "payment") return "/payments";
  return r.docType === "sale_return" ? "/sale-returns" : "/purchase-returns";
}
