import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { MasterDataManager } from "@/components/master-data-manager";
import { saveSupplierAction, toggleSupplierStatusAction } from "./actions";

export const metadata = { title: "供应商管理 - 维川进销存" };

export default async function SuppliersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const suppliers = await prisma.supplier.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, contact: true, phone: true, address: true, remark: true, status: true },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">供应商管理</h1>
      <MasterDataManager
        entityLabel="供应商"
        columns={[
          { key: "name", label: "名称" },
          { key: "contact", label: "联系人" },
          { key: "phone", label: "电话" },
          { key: "address", label: "地址" },
          { key: "remark", label: "备注" },
        ]}
        fields={[
          { name: "name", label: "供应商名称", required: true, maxLength: 100 },
          { name: "contact", label: "联系人", maxLength: 50 },
          { name: "phone", label: "电话", maxLength: 30 },
          { name: "address", label: "地址", maxLength: 200 },
          { name: "remark", label: "备注", maxLength: 200 },
        ]}
        rows={suppliers.map((s) => ({
          id: s.id,
          status: s.status,
          cells: {
            name: s.name,
            contact: s.contact ?? "",
            phone: s.phone ?? "",
            address: s.address ?? "",
            remark: s.remark ?? "",
          },
          formValues: {
            name: s.name,
            contact: s.contact ?? "",
            phone: s.phone ?? "",
            address: s.address ?? "",
            remark: s.remark ?? "",
          },
        }))}
        isAdmin={user.role === "admin"}
        saveAction={saveSupplierAction}
        toggleAction={toggleSupplierStatusAction}
      />
    </div>
  );
}
