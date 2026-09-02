import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";

/**
 * 服务端会话（文档 8.1）：
 * - 会话有效期 8 小时，登出即失效（删除 sessions 行）；
 * - Cookie 仅存随机 token，数据库中只存 sha256(token)，泄漏库文件无法伪造会话；
 * - Cookie：HttpOnly + SameSite=Lax + 生产环境 Secure。
 */

const COOKIE_NAME = "weichuan_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 小时

const MAX_FAILED_LOGINS = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000; // 15 分钟

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function sessionCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSec,
  };
}

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const cookieStore = await cookies();

  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  cookieStore.set(COOKIE_NAME, token, sessionCookieOptions(SESSION_TTL_MS / 1000));
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  }
  cookieStore.delete(COOKIE_NAME);
}

/** 读取当前登录用户；会话不存在/过期/用户被停用返回 null。 */
export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = sha256(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }

  if (session.user.status !== 1) {
    // 用户被停用则立即吊销全部会话
    await prisma.session.deleteMany({ where: { userId: session.userId } });
    return null;
  }

  return session.user;
}

/** 吊销该用户除当前会话外的全部会话（改密/重置密码后使用，当前登录态保留）。 */
export async function revokeOtherSessions(userId: number): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  await prisma.session.deleteMany({
    where: {
      userId,
      ...(token ? { NOT: { tokenHash: sha256(token) } } : {}),
    },
  });
}

/** 登录失败锁定判断：15 分钟内失败 ≥5 次则锁定。返回剩余锁定时长（秒），0 表示未锁定。 */
export async function getLockRemainingSeconds(userId: number): Promise<number> {
  const windowStart = new Date(Date.now() - LOCK_WINDOW_MS);
  const failedCount = await prisma.loginLog.count({
    where: { userId, success: false, createdAt: { gte: windowStart } },
  });
  if (failedCount < MAX_FAILED_LOGINS) return 0;

  const firstFailInWindow = await prisma.loginLog.findFirst({
    where: { userId, success: false, createdAt: { gte: windowStart } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (!firstFailInWindow) return 0;

  const unlockAt = firstFailInWindow.createdAt.getTime() + LOCK_WINDOW_MS;
  return Math.max(0, Math.ceil((unlockAt - Date.now()) / 1000));
}

export const SESSION_CONSTANTS = { COOKIE_NAME };
