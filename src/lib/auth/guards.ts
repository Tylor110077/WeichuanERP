import { getCurrentUser } from "@/lib/auth/session";

/**
 * 服务端权限守卫（文档 5 章权限矩阵）：
 * 前端只做展示控制，所有写操作后端鉴权。
 */

/** 仅管理员可执行，否则抛错（由调用方转为用户可见错误）。 */
export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    throw new Error("无权限执行此操作");
  }
  return user;
}

/** 基础资料写权限：仅管理员；业务员/老板只读（按权限矩阵执行）。 */
export async function requireMasterDataWrite() {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");
  if (user.role !== "admin") {
    throw new Error("基础资料仅管理员可维护");
  }
  return user;
}

/** 只读页面：登录即可（manager 列表页只需登录，写按钮按角色显示）。 */
export async function requireLogin() {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");
  return user;
}
