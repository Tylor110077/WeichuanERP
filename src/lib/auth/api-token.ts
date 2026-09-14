import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/cli/types";

/**
 * CLI / Agent 令牌的铸造与校验。
 *
 * 与 lib/auth/session.ts 同一套安全做法：明文只在铸造时返回一次，库里只存 sha256。
 * **刻意不 import "server-only"**：这个模块要被 scripts/api-token.ts 与将来的服务层测试复用，
 * 而 server-only 会让 tsx 进程外直接抛错（同类先例见 lib/pinyin-server.ts 的注释）。
 * "只在服务端跑"的约束由调用方（端点层）承担。
 */

/** sha256 hex —— 与 sessions.token_hash 同长度（CHAR(64)） */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 32 字节随机 hex（与会话令牌同强度） */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/** 令牌前缀：便于人一眼认出"这是 CLI 令牌"，也便于日志里检索 */
export const TOKEN_PREFIX = "wct_";

export function newTokenPlaintext(): string {
  return `${TOKEN_PREFIX}${generateToken()}`;
}

/**
 * Bearer 令牌 → Actor。
 * 无效 / 已吊销 / 已过期 / 用户已停用，一律返回 null——调用方统一按"未授权"处理，
 * 不区分原因（避免把"这个令牌存在但过期了"这类信息泄露给未授权方）。
 */
export async function resolveApiToken(raw: string): Promise<Actor | null> {
  const token = raw.trim();
  if (!token) return null;
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: { select: { id: true, username: true, displayName: true, role: true, status: true } },
    },
  });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  if (row.user.status !== 1) return null;
  return {
    // 令牌的"性质"决定它是 Agent 还是人：Agent 令牌用于自动化，人自己的令牌用于人工操作
    // （审核类操作是 humanOnly，只有人的令牌能过）。默认 forAgent=true，最安全。
    kind: row.forAgent ? "agent" : "human",
    userId: row.user.id,
    username: row.user.username,
    displayName: row.user.displayName,
    role: row.user.role,
    scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
    tokenId: row.id,
    tokenName: row.name,
    runId: null,
  };
}
