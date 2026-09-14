import type { Actor } from "@/lib/cli/types";

/**
 * 单据来源与审核状态：**由服务层统一写入，CLI 绕不过去**（计划 §5.5 的原则）：
 * Agent 必须诚实标注自己，不能伪装成人做的。
 *
 * 生效时机按 §13.8 / §12 A3 的裁决：**立刻生效、留痕在后**——
 * 所以这里只写"来源 + 待审核"，单据本身照常在创建事务里生效（库存与成本立即变动）。
 * 审核是对已生效单据的事后复核，不是闸门。
 */

export interface ProvenanceFields {
  actorKind: "human" | "agent";
  agentRunId: string | null;
  apiTokenId: number | null;
  reviewStatus: "not_required" | "pending_review";
  version: number;
  revisionOf: number | null;
}

/**
 * 建单时写进单据的来源字段。
 * - 人建的：`actorKind=human`、`reviewStatus=not_required` → 行为与今天完全一致
 * - Agent 建的：`actorKind=agent`、`reviewStatus=pending_review`，并记下 runId 与令牌 id
 */
export function provenanceFor(actor: Actor, opts?: { revisionOf?: number; version?: number }): ProvenanceFields {
  return {
    actorKind: actor.kind,
    agentRunId: actor.kind === "agent" ? (actor.runId ?? null) : null,
    apiTokenId: actor.kind === "agent" ? (actor.tokenId ?? null) : null,
    reviewStatus: actor.kind === "agent" ? "pending_review" : "not_required",
    version: opts?.version ?? 1,
    revisionOf: opts?.revisionOf ?? null,
  };
}

/** docType 的字面值 ↔ 中文标签（审核台与 CLI 共用） */
export const DOC_TYPES = {
  sale_order: "售卖单",
  purchase_order: "进货单",
  sale_return: "售卖退货",
  purchase_return: "进货退货",
  payment: "收付款",
} as const;

export type DocType = keyof typeof DOC_TYPES;

export function isDocType(v: string): v is DocType {
  return v in DOC_TYPES;
}
