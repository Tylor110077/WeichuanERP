"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireLogin } from "@/lib/auth/guards";
import { resolveShortcuts } from "@/lib/shortcuts";
import { writeAudit } from "@/lib/audit";

export type ShortcutSaveState = { ok?: string; error?: string } | null;

/**
 * 保存工作台快捷入口（只改当前登录用户自己的）。
 *
 * 服务端必须再过滤一遍：前端只决定「顺序」，能存什么由目录与角色权限决定，
 * 否则改一下请求就能把无权页面（如业务员放「用户管理」）顶到工作台上。
 */
export async function saveShortcutsAction(
  ids: string[]
): Promise<ShortcutSaveState> {
  const user = await requireLogin();

  const clean = resolveShortcuts(ids, user.role).map((s) => s.id);

  await prisma.user.update({
    where: { id: user.id },
    data: { shortcuts: clean },
  });

  await writeAudit({
    userId: user.id,
    action: "update",
    entityType: "user",
    entityId: user.id,
    after: { shortcuts: clean },
  });

  revalidatePath("/dashboard");
  return { ok: "已保存" };
}

/** 恢复成该角色的默认入口（shortcuts 置回 NULL） */
export async function resetShortcutsAction(): Promise<ShortcutSaveState> {
  const user = await requireLogin();

  await prisma.user.update({
    where: { id: user.id },
    // 库里的 NULL（而非 JSON 的 "null"）才表示"没自定义过"，所以用 DbNull
    data: { shortcuts: Prisma.DbNull },
  });

  await writeAudit({
    userId: user.id,
    action: "update",
    entityType: "user",
    entityId: user.id,
    after: { shortcuts: null, note: "恢复工作台默认快捷入口" },
  });

  revalidatePath("/dashboard");
  return { ok: "已恢复默认" };
}
