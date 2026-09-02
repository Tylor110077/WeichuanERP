import type { UserRole } from "@prisma/client";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "管理员",
  sales: "业务员",
  boss: "老板/财务",
};

/**
 * 权限判定（文档第 5 章权限矩阵）。
 * M1 只用到 admin；单据级权限在 M3/M4 实现时按矩阵补充。
 */
export function isAdmin(role: UserRole): boolean {
  return role === "admin";
}
