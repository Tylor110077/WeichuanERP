"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { writeAudit } from "@/lib/audit";

const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, "账号至少 2 个字符")
    .max(50)
    .regex(/^[A-Za-z0-9_]+$/, "账号仅支持字母、数字、下划线"),
  displayName: z.string().trim().min(1, "请填写姓名").max(50),
  role: z.enum(["admin", "sales", "boss"]),
  password: z.string().min(1, "请填写密码").max(100),
});

export type FormState = { error?: string; ok?: string } | null;

export async function createUserAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = createUserSchema.safeParse({
    username: formData.get("username"),
    displayName: formData.get("displayName"),
    role: formData.get("role"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  }
  const { username, displayName, role, password } = parsed.data;

  const strengthErr = validatePasswordStrength(password);
  if (strengthErr) return { error: strengthErr };

  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) return { error: "账号已存在" };

  const user = await prisma.user.create({
    data: {
      username,
      displayName,
      role: role as UserRole,
      passwordHash: await hashPassword(password),
    },
  });

  await writeAudit({
    userId: admin.id,
    action: "create",
    entityType: "user",
    entityId: user.id,
    after: {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    },
  });
  revalidatePath("/users");
  return { ok: `用户 ${username} 创建成功` };
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const admin = await requireAdmin();
  const userId = Number(formData.get("userId"));
  const newPassword = String(formData.get("newPassword") ?? "");
  if (!Number.isInteger(userId)) return { error: "参数错误" };

  const strengthErr = validatePasswordStrength(newPassword);
  if (strengthErr) return { error: strengthErr };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "用户不存在" };

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  // 重置密码后吊销该用户所有会话，强制重新登录
  await prisma.session.deleteMany({ where: { userId } });

  await writeAudit({
    userId: admin.id,
    action: "reset_password",
    entityType: "user",
    entityId: userId,
    after: { username: user.username, resetBy: admin.username },
  });
  revalidatePath("/users");
  return { ok: `已重置 ${user.username} 的密码` };
}

export async function toggleUserStatusAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const admin = await requireAdmin();
  const userId = Number(formData.get("userId"));
  if (!Number.isInteger(userId)) return { error: "参数错误" };
  if (userId === admin.id) return { error: "不能停用自己" };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "用户不存在" };

  const nextStatus = user.status === 1 ? 0 : 1;
  await prisma.user.update({
    where: { id: userId },
    data: { status: nextStatus },
  });
  if (nextStatus === 0) {
    await prisma.session.deleteMany({ where: { userId } });
  }

  await writeAudit({
    userId: admin.id,
    action: "update",
    entityType: "user",
    entityId: userId,
    before: { username: user.username, status: user.status },
    after: { username: user.username, status: nextStatus },
  });
  revalidatePath("/users");
  return { ok: nextStatus === 1 ? "已启用" : "已停用并可撤销其会话" };
}
