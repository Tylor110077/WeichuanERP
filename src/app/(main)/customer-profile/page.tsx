import { redirect } from "next/navigation";

/**
 * 客户画像已并入「客户详情页」（/customers/[id]）：
 * 一页里既有经营画像、又有该客户的单据明细与资料编辑。
 * 这里保留旧路由做重定向，避免书签/历史链接失效：
 * - 带 customerId → 直接去那个客户的详情页；
 * - 不带 → 回客户管理页的「客户画像」页签（全体客户的汇总视图）。
 */
export default async function CustomerProfileRedirect({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const params = await searchParams;
  const id = params.customerId ? Number(params.customerId) : NaN;
  redirect(Number.isInteger(id) && id > 0 ? `/customers/${id}` : "/customers?tab=profile");
}
