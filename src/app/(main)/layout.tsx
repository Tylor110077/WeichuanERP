import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { logoutAction } from "./logout-action";
import { ROLE_LABELS } from "@/lib/auth/roles";

const NAV_ITEMS = [
  { href: "/dashboard", label: "工作台", roles: ["admin", "sales", "boss"] },
  { href: "/users", label: "用户管理", roles: ["admin"] },
  { href: "/audit-logs", label: "审计日志", roles: ["admin"] },
  { href: "/profile", label: "个人中心", roles: ["admin", "sales", "boss"] },
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

  const nav = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="flex w-52 flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-4">
          <div className="text-base font-semibold text-gray-900">维川进销存</div>
        </div>
        <nav className="flex-1 space-y-1 px-2 py-3">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              {item.label}
            </Link>
          ))}
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
