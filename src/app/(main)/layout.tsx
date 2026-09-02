import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { logoutAction } from "./logout-action";
import { ROLE_LABELS } from "@/lib/auth/roles";

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
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/users", label: "用户管理", roles: ["admin"] },
      { href: "/audit-logs", label: "审计日志", roles: ["admin"] },
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
          <div className="text-base font-semibold text-gray-900">维川进销存</div>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
          {NAV_GROUPS.map((group, gi) => {
            const items = group.items.filter((item) => item.roles.includes(user.role));
            if (items.length === 0) return null;
            return (
              <div key={gi}>
                {group.label && (
                  <div className="px-3 pb-1 text-xs font-medium text-gray-400">
                    {group.label}
                  </div>
                )}
                <div className="space-y-1">
                  {items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
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
