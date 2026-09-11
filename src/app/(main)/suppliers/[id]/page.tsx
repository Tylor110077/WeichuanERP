import { redirect, notFound } from "next/navigation";
import { NoPermission } from "@/components/empty-state";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { EntityForm } from "@/components/entity-form";
import { saveSupplierAction } from "../actions";

export const metadata = { title: "编辑厂家 - 玮川进销存" };

export default async function EditSupplierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return (
      <NoPermission text="无权限（仅管理员可维护厂家）" />
    );
  }

  const { id: idRaw } = await params;
  const id = Number(idRaw);
  const supplier = Number.isInteger(id)
    ? await prisma.supplier.findUnique({ where: { id } })
    : null;
  if (!supplier) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">编辑厂家</h1>
      <EntityForm
        fields={[
          { name: "name", label: "厂家名称 *", required: true, maxLength: 100 },
          { name: "contact", label: "联系人", maxLength: 50 },
          { name: "phone", label: "电话", maxLength: 30 },
          { name: "address", label: "地址", maxLength: 200 },
          { name: "remark", label: "备注", maxLength: 200 },
        ]}
        initial={{
          name: supplier.name,
          contact: supplier.contact ?? "",
          phone: supplier.phone ?? "",
          address: supplier.address ?? "",
          remark: supplier.remark ?? "",
        }}
        initialId={supplier.id}
        saveAction={saveSupplierAction}
        submitLabel="保存修改"
      />
      <Link href="/suppliers" className="text-sm text-gray-500 hover:underline">
        ← 返回厂家列表
      </Link>
    </div>
  );
}
