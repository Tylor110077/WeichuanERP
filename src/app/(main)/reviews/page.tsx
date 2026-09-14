import { redirect } from "next/navigation";
import Link from "next/link";
import { NoPermission } from "@/components/empty-state";
import { getCurrentUser } from "@/lib/auth/session";
import { humanActor } from "@/lib/cli/types";
import { listReviews } from "@/lib/services/review";
import { DOC_TYPES } from "@/lib/services/provenance";
import { btnSecondary } from "@/lib/ui";
import { ReviewConsole, type ReviewRow } from "./review-console";

export const metadata = { title: "待审核 - 玮川进销存" };

/**
 * 审核台：Agent 代做的单据在这里复核。
 *
 * 这套审核是**事后复核**（按 §12 A3 的裁决）：单据创建时就生效了，库存与成本当场变动。
 * 所以这里有两个视图，第二个尤其重要：
 * - 「待审核」：还没有复核结论的
 * - 「待作废」：已驳回但**仍占着库存/成本账**的——驳回不等于撤销，
 *   必须去把单据作废，否则这批货就一直挂在账上。这个视图是整套设计里最后一道人工环节。
 */
export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ tab?: string; run?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin" && user.role !== "boss") {
    return <NoPermission text="无权限查看待审核（管理员/老板）" />;
  }

  const params = await searchParams;
  const tab = params.tab === "needs-void" ? "needs-void" : params.tab === "approved" ? "approved" : params.tab === "rejected" ? "rejected" : "pending";
  const actor = humanActor(user);

  const result = await listReviews(actor, {
    status: tab === "needs-void" ? "rejected" : tab === "approved" ? "approved" : tab === "rejected" ? "rejected" : "pending_review",
    agentRunId: params.run,
    needsVoid: tab === "needs-void",
    pageSize: 200,
  });
  if (!result.ok) {
    return <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">{result.error.message}</div>;
  }
  const rows = (result.data.rows as ReviewRow[]).map((r) => ({
    ...r,
    docTypeLabel: DOC_TYPES[r.docType as keyof typeof DOC_TYPES] ?? r.docType,
  }));

  // 按批次分组：一次需求 = 一个 agentRunId = 一批单据，人应该整批过
  const batches = new Map<string, number>();
  for (const r of rows) {
    const k = r.agentRunId ?? "（未标批次）";
    batches.set(k, (batches.get(k) ?? 0) + 1);
  }

  const tabs = [
    { key: "pending", label: `待审核 ${tab === "pending" ? rows.length : ""}`.trim(), href: "/reviews" },
    { key: "needs-void", label: "待作废（已驳回未撤账）", href: "/reviews?tab=needs-void" },
    { key: "approved", label: "已通过", href: "/reviews?tab=approved" },
    { key: "rejected", label: "已驳回", href: "/reviews?tab=rejected" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">待审核</h1>
        <Link href="/dashboard" className={btnSecondary}>
          ← 返回工作台
        </Link>
      </div>

      <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
        这些单据是 <b>Agent 代做</b>的：它们**创建时就生效**（库存与成本当场变动），这里是事后复核。
        通过就归档；<b>驳回只打标、不撤账</b>——要让它退出库存/成本账，得去「待作废」里把单据作废。
      </p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={
              tab === t.key
                ? "rounded-md bg-gray-900 px-3 py-1.5 text-white"
                : "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50"
            }
          >
            {t.label}
          </Link>
        ))}
        {params.run && (
          <span className="text-xs text-gray-500">
            只看批次 <code className="rounded bg-gray-100 px-1">{params.run}</code>
            <Link href={`/reviews${tab === "pending" ? "" : `?tab=${tab}`}`} className="ml-2 text-blue-600 hover:underline">
              清除
            </Link>
          </span>
        )}
      </div>

      {batches.size > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          批次：
          {[...batches.entries()].map(([runId, n]) => (
            <Link
              key={runId}
              href={`/reviews?${tab === "pending" ? "" : `tab=${tab}&`}run=${encodeURIComponent(runId)}`}
              className="rounded border border-gray-200 px-2 py-0.5 hover:bg-gray-50"
            >
              {runId}（{n}）
            </Link>
          ))}
        </div>
      )}

      <ReviewConsole rows={rows} />
    </div>
  );
}
