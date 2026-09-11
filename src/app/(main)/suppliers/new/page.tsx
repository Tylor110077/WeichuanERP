import { redirect } from "next/navigation";

/**
 * 厂家建档已并入「商品与厂家」页面：在厂家管理折叠区可就地新建。
 * 旧路由保留重定向，避免书签与历史链接失效（功能位置见注释）。
 */
export default function Page() {
  redirect("/products");
}
