import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "个人中心 - 玮川进销存" };

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">个人中心</h1>

      <div className="max-w-md rounded-xl border border-gray-200 bg-white p-5 text-sm">
        <div className="flex justify-between py-1.5">
          <span className="text-gray-500">账号</span>
          <span className="text-gray-900">{user.username}</span>
        </div>
        <div className="flex justify-between py-1.5">
          <span className="text-gray-500">姓名</span>
          <span className="text-gray-900">{user.displayName}</span>
        </div>
        <div className="flex justify-between py-1.5">
          <span className="text-gray-500">角色</span>
          <span className="text-gray-900">{ROLE_LABELS[user.role]}</span>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">修改密码</h2>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
