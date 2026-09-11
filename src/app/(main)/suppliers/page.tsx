import { redirect } from "next/navigation";

/**
 * 厂家管理已并入「商品与厂家」页面：按厂家查看其供应商品。
 * 旧路由保留重定向，避免书签/历史链接失效。
 */
export default function SuppliersPage() {
  redirect("/products");
}
