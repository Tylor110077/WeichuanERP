import { redirect } from "next/navigation";
import Link from "next/link";
import { NoPermission } from "@/components/empty-state";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { btnPrimary, btnSecondary, inputBase } from "@/lib/ui";
import { FilterForm } from "@/components/filter-form";
import { SearchInput } from "@/components/search-input";
import { UserRowActions } from "./user-row-actions";
import type { UserRole } from "@prisma/client";

export const metadata = { title: "用户管理 - 玮川进销存" };

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "admin", label: ROLE_LABELS.admin },
  { value: "sales", label: ROLE_LABELS.sales },
  { value: "boss", label: ROLE_LABELS.boss },
];

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; status?: string }>;
}) {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (current.role !== "admin") {
    return (
      <NoPermission text="无权限访问用户管理（仅管理员）" />
    );
  }

  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const role = params.role ?? "";
  const status = params.status ?? "";

  const users = await prisma.user.findMany({
    where: {
      ...(q
        ? { OR: [{ username: { contains: q } }, { displayName: { contains: q } }] }
        : {}),
      ...(role ? { role: role as UserRole } : {}),
      ...(status ? { status: status === "disabled" ? 0 : 1 } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  const total = await prisma.user.count();

  const filtered = Boolean(q || role || status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">用户管理</h1>
        <Link href="/users/new" className={btnPrimary}>
          + 新建用户
        </Link>
      </div>

      <FilterForm className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <SearchInput
          name="q"
          type="text"
          placeholder="账号 / 姓名"
          defaultValue={q}
          className={`${inputBase} w-48`}
        />
        <select name="role" defaultValue={role} className={`${inputBase}`}>
          <option value="">全部角色</option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status} className={`${inputBase}`}>
          <option value="">全部状态</option>
          <option value="active">启用</option>
          <option value="disabled">停用</option>
        </select>
        <button type="submit" className={btnSecondary}>
          筛选
        </button>
        <span className="text-xs text-gray-500">
          {filtered ? `匹配 ${users.length} / 共 ${total} 人` : `共 ${total} 人`}
        </span>
        {filtered && (
          <Link href="/users" className="text-xs text-blue-600 hover:underline">
            清除条件
          </Link>
        )}
      </FilterForm>

      <div className="scroll-thin max-h-[32rem] overflow-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50 text-left text-xs text-gray-500">
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
          <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  {filtered ? (
                    <>
                      没有符合条件的用户。
                      <Link href="/users" className="ml-1 text-blue-600 hover:underline">
                        清除筛选条件
                      </Link>
                    </>
                  ) : (
                    <>
                      还没有用户，点右上角
                      <Link href="/users/new" className="mx-1 text-blue-600 hover:underline">
                        + 新建用户
                      </Link>
                      添加第一个。
                    </>
                  )}
                </td>
              </tr>
            )}
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
