import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * IP 级登录限流（文档 8.1 登录防护的补充）：
 * 单账号 5 次/15 分钟锁定只防"盯一个账号"的爆破；
 * 撞库/账号喷洒会换账号名，因此再加一层：同一 IP 5 分钟内失败 ≥20 次即临时拒绝。
 * 正常办公场景（多人共用出口 IP）失败次数远低于阈值，不会误伤。
 */
const IP_WINDOW_MS = 5 * 60 * 1000;
const IP_MAX_FAILURES = 20;

export async function isLoginIpThrottled(ip: string | null): Promise<boolean> {
  if (!ip) return false;
  const failures = await prisma.loginLog.count({
    where: {
      ip,
      success: false,
      createdAt: { gte: new Date(Date.now() - IP_WINDOW_MS) },
    },
  });
  return failures >= IP_MAX_FAILURES;
}
