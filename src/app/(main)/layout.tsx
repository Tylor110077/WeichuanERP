import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { logoutAction } from "./logout-action";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { SidebarNav } from "@/components/sidebar-nav";

const ALL_ROLES = ["admin", "sales", "boss"] as const;

const NAV_GROUPS: {
  label: string | null;
  items: { href: string; label: string; roles: readonly string[] }[];
}[] = [
  {
    label: null,
    items: [{ href: "/dashboard", label: "工作台", roles: ALL_ROLES }],
  },
  {
    label: "进货",
    items: [
      { href: "/purchase-orders", label: "进货单", roles: ALL_ROLES },
      { href: "/purchase-orders/new", label: "进货开单", roles: ["admin", "sales"] },
      { href: "/purchase-returns", label: "进货退货", roles: ALL_ROLES },
    ],
  },
  {
    label: "销售",
    items: [
      { href: "/sale-orders", label: "售卖单", roles: ALL_ROLES },
      { href: "/sale-orders/new", label: "销售开单", roles: ["admin", "sales"] },
      { href: "/sale-returns", label: "销售退货", roles: ALL_ROLES },
    ],
  },
  {
    label: "库存",
    items: [
      { href: "/inventory", label: "库存查询", roles: ALL_ROLES },
      { href: "/stock-movements", label: "库存流水", roles: ["admin", "boss"] },
    ],
  },
  {
    label: "财务",
    items: [
      { href: "/receivables-payables", label: "应收应付", roles: ["admin", "boss"] },
      { href: "/supplier-statement", label: "供应商对账", roles: ["admin", "boss"] },
      { href: "/customer-profile", label: "客户画像", roles: ["admin", "boss"] },
      { href: "/sales-analysis", label: "销售分析", roles: ["admin", "boss"] },
      { href: "/reports", label: "报表中心", roles: ["admin", "boss"] },
    ],
  },
  {
    label: "基础资料",
    items: [
      { href: "/products", label: "商品管理", roles: ALL_ROLES },
      { href: "/categories", label: "商品分类", roles: ALL_ROLES },
      { href: "/units", label: "单位字典", roles: ALL_ROLES },
      { href: "/suppliers", label: "供应商管理", roles: ALL_ROLES },
      { href: "/customers", label: "客户管理", roles: ALL_ROLES },
      { href: "/customer-groups", label: "客户组织", roles: ALL_ROLES },
      { href: "/customer-tags", label: "客户标签", roles: ALL_ROLES },
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/users", label: "用户管理", roles: ["admin"] },
      { href: "/audit-logs", label: "审计日志", roles: ["admin"] },
      { href: "/login-logs", label: "登录日志", roles: ["admin"] },
      { href: "/profile", label: "个人中心", roles: ALL_ROLES },
    ],
  },
];

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="flex w-52 flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-4">
          <div className="text-base font-semibold text-gray-900">玮川进销存</div>
        </div>
        <SidebarNav
          groups={NAV_GROUPS.map((group) => ({
            label: group.label,
            items: group.items
              .filter((item) => item.roles.includes(user.role))
              .map(({ href, label }) => ({ href, label })),
          })).filter((g) => g.items.length > 0)}
        />
        <div className="border-t border-gray-200 px-4 py-3">
          <div className="text-sm text-gray-900">{user.displayName}</div>
          <div className="text-xs text-gray-500">{ROLE_LABELS[user.role]}</div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="mt-2 text-xs text-blue-600 hover:underline"
            >
              退出登录
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto p-6">{children}</main>
    </div>
  );
}
