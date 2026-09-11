import { redirect } from "next/navigation";

/**
 * 单位管理已并入「商品与厂家」页面：在单位管理折叠区内维护。
 * 旧路由保留重定向，避免书签与历史链接失效（功能位置见注释）。
 */
export default function Page() {
  redirect("/products");
}
