import { redirect } from "next/navigation";
import { NoPermission } from "@/components/empty-state";
import Link from "next/link";
import { btnSecondary } from "@/lib/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { EntityForm } from "@/components/entity-form";
import { saveCustomerAction } from "../actions";

export const metadata = { title: "新建客户 - 玮川进销存" };

export default async function NewCustomerPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return (
      <NoPermission text="无权限（仅管理员可维护客户）" />
    );
  }

  const [groups, tags] = await Promise.all([
    prisma.customerGroup.findMany({ where: { status: 1 }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.customerTag.findMany({ where: { status: 1 }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">新建客户</h1>
        <Link href="/customers" className={btnSecondary}>
          ← 返回客户列表
        </Link>
      </div>
      <EntityForm
        fields={[
          { name: "name", label: "客户名称 *", required: true, maxLength: 100 },
          { name: "contact", label: "联系人", maxLength: 50 },
          { name: "phone", label: "电话", maxLength: 30 },
          { name: "address", label: "地址", maxLength: 200 },
          { name: "remark", label: "备注", maxLength: 200 },
          {
            name: "groupId",
            label: "所属组织",
            placeholder: "可选，输入关键词搜索",
            type: "searchselect",
            noneLabel: "未分组",
            options: groups.map((g) => ({ value: String(g.id), label: g.name })),
          },
          { name: "tagIds", label: "标签", type: "multiselect", options: tags.map((t) => ({ value: String(t.id), label: t.name })) },
        ]}
        saveAction={saveCustomerAction}
        submitLabel="创建客户"
      />
    </div>
  );
}
