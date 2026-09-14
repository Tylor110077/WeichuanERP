"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { humanActor } from "@/lib/cli/types";
import { approveReview, commentReview, rejectReview } from "@/lib/services/review";

/**
 * 审核台的服务端入口：薄壳——鉴权（网页会话）→ 调服务层 → 刷新。
 *
 * 逻辑全在 lib/services/review.ts，与 CLI 的 review approve/reject/comment 同一份。
 * 「只能由人审核」在 CLI 那侧由注册表的 humanOnly 强制；这里靠"必须有 cookie 会话"
 * （Agent 令牌根本拿不到会话）。
 */

export type ReviewActionState = { error?: string; ok?: string } | null;

export async function reviewAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };
  if (user.role !== "admin" && user.role !== "boss") return { error: "仅管理员/老板可审核" };

  const kindRaw = String(formData.get("__kind") ?? "approve");
  const kind = kindRaw === "reject" ? "reject" : kindRaw === "comment" ? "comment" : "approve";
  const keys = formData.getAll("docs").map(String).filter(Boolean);
  const notes = String(formData.get("notes") ?? "").trim();

  if (keys.length === 0) return { error: "请先勾选要处理的单据" };
  if (kind === "reject" && !notes) return { error: "驳回必须写原因（Agent 要按它改）" };
  if (kind === "approve" && !notes) return { error: "请填写审核意见" };

  const actor = humanActor(user);
  const okList: string[] = [];
  const errList: string[] = [];
  for (const key of keys) {
    const [docType, idRaw] = key.split("|");
    const docId = Number(idRaw);
    if (!docType || !Number.isInteger(docId)) continue;
    const r =
      kind === "approve"
        ? await approveReview(actor, { docType, docId, notes }, { dryRun: false })
        : kind === "reject"
          ? await rejectReview(actor, { docType, docId, notes }, { dryRun: false })
          : await commentReview(actor, { docType, docId, notes }, { dryRun: false });
    if (r.ok) okList.push(String((r.data.plan as { 单据: string }).单据));
    else errList.push(`${docType}#${docId} ${r.error.message}`);
  }

  revalidatePath("/reviews");
  for (const p of ["/sale-orders", "/purchase-orders", "/sale-returns", "/purchase-returns", "/payments"]) revalidatePath(p);

  const label = kind === "approve" ? "通过" : kind === "reject" ? "驳回" : "留言";
  if (errList.length > 0) {
    return { error: `${label}成功 ${okList.length} 张，失败 ${errList.length} 张：${errList.slice(0, 3).join("；")}` };
  }
  return {
    ok:
      `已${label} ${okList.length} 张：${okList.join("、")}` +
      (kind === "reject" ? "。⚠️ 驳回不等于撤销——这些单仍已生效，请在「待作废」里把它们作废" : ""),
  };
}
