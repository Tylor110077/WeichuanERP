import { redirect } from "next/navigation";
import { NoPermission } from "@/components/empty-state";
import Link from "next/link";
import { btnSecondary } from "@/lib/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { EntityForm } from "@/components/entity-form";
import { createUserAction } from "../actions";

export const metadata = { title: "新建用户 - 玮川进销存" };

export default async function NewUserPage() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (current.role !== "admin") {
    return (
      <NoPermission text="无权限访问用户管理（仅管理员）" />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">新建用户</h1>
        <Link href="/users" className={btnSecondary}>
          ← 返回用户列表
        </Link>
      </div>

      <EntityForm
        fields={[
          {
            name: "username",
            label: "账号 *",
            required: true,
            minLength: 2,
            maxLength: 50,
            placeholder: "登录用，字母 / 数字 / 下划线，2–50 位",
          },
          {
            name: "displayName",
            label: "姓名 *",
            required: true,
            maxLength: 50,
            placeholder: "显示在单据「经手人 / 制单人」上",
          },
          {
            name: "role",
            label: "角色",
            required: true,
            type: "select",
            defaultValue: "sales",
            options: [
              { value: "", label: "请选择角色" },
              { value: "sales", label: "业务员（开单，看不到进价与毛利）" },
              { value: "boss", label: "老板/财务（可看进价与毛利）" },
              { value: "admin", label: "管理员（可维护商品、客户与用户）" },
            ],
          },
          {
            name: "password",
            label: "初始密码 *",
            required: true,
            type: "password",
            minLength: 8,
            maxLength: 100,
            placeholder: "≥8 位，含字母和数字",
          },
        ]}
        saveAction={createUserAction}
        submitLabel="创建用户"
      />
    </div>
  );
}
