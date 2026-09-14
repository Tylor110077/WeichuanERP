import { NextResponse, type NextRequest } from "next/server";
import { resolveApiToken } from "@/lib/auth/api-token";
import { findOp, opNames } from "@/lib/cli/registry";
import { ERROR_STATUS, fail, type CliResult } from "@/lib/cli/types";
import { prisma } from "@/lib/prisma";

/**
 * CLI / Agent 的唯一入口。
 *
 * 设计要点（见 docs/agent-cli-plan.md §13.1）：
 * - **只认 Bearer**：不接受 cookie 身份。没有 ambient credential，就天然免 CSRF；
 *   同时让 CLI 令牌与网页会话彻底隔离。
 * - **一个 op 参数分发**：op 名与 CLI 命令 1:1，权限声明集中在 lib/cli/registry.ts，
 *   不在这里逐条判断——否则又会退化成"鉴权散落各处"。
 * - 这里**只做传输与鉴权适配**，业务逻辑一律在服务层，不在本文件里写业务。
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!bearer) return reply(fail("UNAUTHORIZED", "缺少 Authorization: Bearer <令牌>"));

  const actor = await resolveApiToken(bearer[1]);
  if (!actor) return reply(fail("UNAUTHORIZED", "令牌无效、已过期或已吊销"));

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(fail("INVALID", "请求体不是合法 JSON"));
  }
  const { op, input, runId, commit } = (body ?? {}) as {
    op?: unknown;
    input?: Record<string, unknown>;
    runId?: unknown;
    /** 只有显式 true 才允许写操作落库（CLI 的 --yes 传它） */
    commit?: unknown;
  };
  if (typeof op !== "string" || op === "") return reply(fail("INVALID", "缺少 op"));

  const def = findOp(op);
  if (!def) {
    return reply(fail("NOT_FOUND", `未知命令：${op}（可用：${opNames().join(", ")}）`));
  }

  // 人类专属：Agent 令牌一律拒绝——这是"Agent 不能自审自批"的落点
  if (def.humanOnly && actor.kind !== "human") {
    return reply(fail("FORBIDDEN", `「${op}」仅限人类操作，Agent 令牌无权执行`));
  }
  if (def.requiredScope && !actor.scopes.includes(def.requiredScope)) {
    return reply(fail("FORBIDDEN", `令牌缺少权限「${def.requiredScope}」`));
  }

  /**
   * 写操作默认预演：dryRun 由**服务端**决定，不是客户端说了算——
   * 只有 `commit: true`（CLI 的 `--yes`）才落库。这样即使有人拿 curl 直接打端点，
   * 也不会因为漏传参数而误写；想绕过只能显式传 commit。
   */
  const dryRun = def.write ? commit !== true : false;

  try {
    const result = await def.handler(
      { ...actor, runId: typeof runId === "string" ? runId : null },
      input ?? {},
      { dryRun }
    );
    // 记录最近使用时间：失败不影响本次调用（不能因为写时间戳失败就让命令失败）
    if (actor.tokenId != null) {
      void prisma.apiToken
        .update({ where: { id: actor.tokenId }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }
    return reply(result);
  } catch (e) {
    console.error(`[cli] op 执行失败：${op}`, e);
    return reply(fail("INTERNAL", "服务内部错误，请查看服务端日志"));
  }
}

/** GET 只是给人看的提示：让误用浏览器打开的人知道该用 POST */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { ok: false, error: { code: "INVALID", message: "请用 POST 调用，并带 Authorization: Bearer 令牌" } },
    { status: 405, headers: { Allow: "POST" } }
  );
}

function reply(result: CliResult<unknown>): NextResponse {
  const status = result.ok ? 200 : ERROR_STATUS[result.error.code];
  return NextResponse.json(result, { status });
}
