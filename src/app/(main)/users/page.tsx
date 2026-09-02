import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { CreateUserForm } from "./create-user-form";
import { UserRowActions } from "./user-row-actions";

export const metadata = { title: "用户管理 - 维川进销存" };

export default async function UsersPage() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (current.role !== "admin") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限访问用户管理（仅管理员）
      </div>
    );
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">用户管理</h1>
      </div>

      <CreateUserForm />

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">账号</th>
              <th className="px-4 py-3 font-medium">姓名</th>
              <th className="px-4 py-3 font-medium">角色</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">最近登录</th>
              <th className="px-4 py-3 font-medium">创建时间</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-4 py-2.5 text-gray-900">{user.username}</td>
                <td className="px-4 py-2.5 text-gray-900">{user.displayName}</td>
                <td className="px-4 py-2.5 text-gray-600">
                  {ROLE_LABELS[user.role]}
                </td>
                <td className="px-4 py-2.5">
                  {user.status === 1 ? (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                      启用
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      停用
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-gray-600">
                  {user.lastLoginAt
                    ? user.lastLoginAt.toLocaleString("zh-CN")
                    : "—"}
                </td>
                <td className="px-4 py-2.5 text-gray-600">
                  {user.createdAt.toLocaleString("zh-CN")}
                </td>
                <td className="px-4 py-2.5">
                  <UserRowActions
                    userId={user.id}
                    status={user.status}
                    isSelf={user.id === current.id}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
