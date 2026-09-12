import { redirect } from "next/navigation";
import { NoPermission } from "@/components/empty-state";
import Link from "next/link";
import { btnSecondary } from "@/lib/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { EntityForm } from "@/components/entity-form";
import { saveCustomerGroupAndReturnAction } from "../../actions";

export const metadata = { title: "新建客户组织 - 玮川进销存" };

/**
 * 独立新建页：列表页右上角「+ 新建 XX」跳到这里填。
 * 列表页里那套内联新建表单已去掉（与右上角按钮重复），编辑仍走列表页的行内表单。
 */
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return <NoPermission text="无权限（仅管理员可维护客户组织）" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">新建客户组织</h1>
        <Link href="/customers?tab=groups" className={btnSecondary}>
          ← 返回客户管理
        </Link>
      </div>

      <EntityForm
        fields={[{ name: "name", label: "组织名称 *", required: true, maxLength: 50, placeholder: "如：渝北区、老客户" }]}
        saveAction={saveCustomerGroupAndReturnAction}
        submitLabel="创建组织"
      />
    </div>
  );
}
