import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { logoutAction } from "./logout-action";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { AppShell } from "@/components/app-shell";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";

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
    // 单据一栏：售卖 / 进货 / 退货。退货以前只在单据详情页里能发起，列表没有入口
    label: "单据",
    items: [
      { href: "/sale-orders", label: "售卖单", roles: ALL_ROLES },
      { href: "/purchase-orders", label: "进货单", roles: ALL_ROLES },
      { href: "/sale-returns", label: "退货单", roles: ALL_ROLES },
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
    // 原名「财务」但里面 3/4 是分析报表，老板想"看赚了多少"不会去点财务；
    // 改名为「财务分析」，涵盖钱与分析两类任务
    label: "财务分析",
    items: [
      { href: "/receivables-payables", label: "应收应付", roles: ["admin", "boss"] },
      { href: "/sales-analysis", label: "销售分析", roles: ["admin", "boss"] },
      { href: "/price-analysis", label: "价格分析", roles: ["admin", "boss"] },
      { href: "/reports", label: "报表中心", roles: ["admin", "boss"] },
    ],
  },
  {
    label: "资料",
    items: [
      // 厂家档案已并入商品页：按厂家查看其商品
      { href: "/products", label: "商品与厂家", roles: ALL_ROLES },
      { href: "/customers", label: "客户管理", roles: ALL_ROLES },
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/users", label: "用户管理", roles: ["admin"] },
      { href: "/audit-logs", label: "审计日志", roles: ["admin"] },
      { href: "/login-logs", label: "登录日志", roles: ["admin"] },
      { href: "/backups", label: "备份与恢复", roles: ["admin"] },
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

  // 侧边栏收起状态由服务端从 Cookie 读取：刷新或表单 GET 跳转时直接渲染正确状态，避免闪烁
  const cookieStore = await cookies();
  const initialCollapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <AppShell
      initialCollapsed={initialCollapsed}
      groups={NAV_GROUPS.map((group) => ({
        label: group.label,
        items: group.items
          .filter((item) => item.roles.includes(user.role))
          .map(({ href, label }) => ({ href, label })),
      })).filter((g) => g.items.length > 0)}
      footer={
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
      }
    >
      {children}
    </AppShell>
  );
}
