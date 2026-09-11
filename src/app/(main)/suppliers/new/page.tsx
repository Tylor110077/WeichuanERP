import { redirect } from "next/navigation";
import { NoPermission } from "@/components/empty-state";
import Link from "next/link";
import { btnSecondary } from "@/lib/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { EntityForm } from "@/components/entity-form";
import { saveSupplierAction } from "../actions";

export const metadata = { title: "新建厂家 - 玮川进销存" };

export default async function NewSupplierPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return (
      <NoPermission text="无权限（仅管理员可维护厂家）" />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">新建厂家</h1>
        <Link href="/suppliers" className={btnSecondary}>
          ← 返回厂家列表
        </Link>
      </div>
      <EntityForm
        fields={[
          { name: "name", label: "厂家名称 *", required: true, maxLength: 100 },
          { name: "contact", label: "联系人", maxLength: 50 },
          { name: "phone", label: "电话", maxLength: 30 },
          { name: "address", label: "地址", maxLength: 200 },
          { name: "remark", label: "备注", maxLength: 200 },
        ]}
        saveAction={saveSupplierAction}
        submitLabel="创建厂家"
      />
    </div>
  );
}
