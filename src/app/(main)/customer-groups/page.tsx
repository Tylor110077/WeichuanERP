import { redirect } from "next/navigation";

/**
 * 客户组织管理已并入「客户管理」页面：在客户组织管理折叠区内维护。
 * 旧路由保留重定向，避免书签与历史链接失效（功能位置见注释）。
 */
export default function Page() {
  redirect("/customers");
}
