"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, revokeOtherSessions } from "@/lib/auth/session";
import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from "@/lib/auth/password";
import { writeAudit } from "@/lib/audit";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码").max(100),
  newPassword: z.string().min(1, "请输入新密码").max(100).refine(
    (pw) => validatePasswordStrength(pw) === null,
    { message: "新密码需 ≥8 位且同时包含字母和数字" }
  ),
  confirmPassword: z.string().min(1, "请重复新密码").max(100),
});

export type FormState = { error?: string; ok?: string } | null;

export async function changePasswordAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues.find((i) => i.path[0] === "newPassword");
    return {
      error: issue?.message ?? parsed.error.issues[0]?.message ?? "输入有误",
    };
  }
  const { currentPassword, newPassword } = parsed.data;

  if (newPassword !== formData.get("confirmPassword")) {
    return { error: "两次输入的新密码不一致" };
  }

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) return { error: "当前密码错误" };

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  // 改密后吊销该用户的其他会话（保留当前登录态）
  await revokeOtherSessions(user.id);

  await writeAudit({
    userId: user.id,
    action: "update",
    entityType: "user",
    entityId: user.id,
    after: { username: user.username, passwordChanged: true },
  });

  return { ok: "密码修改成功" };
}
