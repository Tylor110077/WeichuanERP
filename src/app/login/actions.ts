"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  consumeDummyVerify,
  verifyPassword,
} from "@/lib/auth/password";
import {
  createSession,
  getCurrentUser,
  getLockRemainingSeconds,
} from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";

const loginSchema = z.object({
  username: z.string().trim().min(1, "请输入账号").max(50),
  password: z.string().min(1, "请输入密码").max(100),
});

export type LoginState = { error?: string } | null;

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  }
  const { username, password } = parsed.data;

  // 已登录直接进系统
  if (await getCurrentUser()) {
    redirect("/dashboard");
  }

  const user = await prisma.user.findUnique({ where: { username } });

  if (!user) {
    await consumeDummyVerify(); // 等时校验，防账号枚举
    await writeAudit({ action: "login", entityType: "login", ip: null });
    await prisma.loginLog.create({
      data: { userId: null, username, success: false },
    });
    return { error: "账号或密码错误" };
  }

  const lockSeconds = await getLockRemainingSeconds(user.id);
  if (lockSeconds > 0) {
    await writeAudit({
      userId: user.id,
      action: "login",
      entityType: "login",
      after: { locked: true },
    });
    await prisma.loginLog.create({
      data: { userId: user.id, username, success: false },
    });
    return {
      error: `账号已锁定，请 ${Math.ceil(lockSeconds / 60)} 分钟后再试`,
    };
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    await writeAudit({ userId: user.id, action: "login", entityType: "login" });
    await prisma.loginLog.create({
      data: { userId: user.id, username, success: false },
    });
    return { error: "账号或密码错误" };
  }

  if (user.status !== 1) {
    await writeAudit({ userId: user.id, action: "login", entityType: "login" });
    return { error: "账号已停用，请联系管理员" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  await createSession(user.id);
  await writeAudit({
    userId: user.id,
    action: "login",
    entityType: "login",
    after: { username: user.username, success: true },
  });
  redirect("/dashboard");
}
