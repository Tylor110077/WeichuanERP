"use server";

import { redirect } from "next/navigation";
import { destroySession, getCurrentUser } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";

export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  await destroySession();
  if (user) {
    await writeAudit({
      userId: user.id,
      action: "logout",
      entityType: "session",
    });
  }
  redirect("/login");
}
