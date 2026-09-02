import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { EntityForm } from "@/components/entity-form";
import { saveCustomerAction } from "../actions";

export const metadata = { title: "编辑客户 - 玮川进销存" };

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限（仅管理员可维护客户）
      </div>
    );
  }

  const { id: idRaw } = await params;
  const id = Number(idRaw);
  const customer = Number.isInteger(id)
    ? await prisma.customer.findUnique({
        where: { id },
        include: { tagLinks: true },
      })
    : null;
  if (!customer) notFound();

  const [groups, tags] = await Promise.all([
    prisma.customerGroup.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, status: true } }),
    prisma.customerTag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, status: true } }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">编辑客户（改组织即移动）</h1>
      <EntityForm
        fields={[
          { name: "name", label: "客户名称 *", required: true, maxLength: 100 },
          { name: "contact", label: "联系人", maxLength: 50 },
          { name: "phone", label: "电话", maxLength: 30 },
          { name: "address", label: "地址", maxLength: 200 },
          { name: "remark", label: "备注", maxLength: 200 },
          {
            name: "groupId",
            label: "所属组织（改组织即移动）",
            type: "select",
            options: [
              { value: "", label: "未分组" },
              ...groups.map((g) => ({ value: String(g.id), label: g.status === 1 ? g.name : `${g.name}（停用）` })),
            ],
          },
          {
            name: "tagIds",
            label: "标签（可多选）",
            type: "multiselect",
            options: tags.map((t) => ({ value: String(t.id), label: t.status === 1 ? t.name : `${t.name}（停用）` })),
          },
        ]}
        initial={{
          name: customer.name,
          contact: customer.contact ?? "",
          phone: customer.phone ?? "",
          address: customer.address ?? "",
          remark: customer.remark ?? "",
          groupId: customer.groupId != null ? String(customer.groupId) : "",
        }}
        initialId={customer.id}
        initialTags={customer.tagLinks.map((l) => String(l.tagId))}
        saveAction={saveCustomerAction}
        submitLabel="保存修改"
      />
      <Link href="/customers" className="text-sm text-gray-500 hover:underline">
        ← 返回客户列表
      </Link>
    </div>
  );
}
