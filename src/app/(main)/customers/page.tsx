import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { MasterDataManager } from "@/components/master-data-manager";
import { saveCustomerAction, toggleCustomerStatusAction } from "./actions";

export const metadata = { title: "客户管理 - 玮川进销存" };

export default async function CustomersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, contact: true, phone: true, address: true, remark: true, status: true },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">客户管理</h1>
      <MasterDataManager
        entityLabel="客户"
        columns={[
          { key: "name", label: "名称" },
          { key: "contact", label: "联系人" },
          { key: "phone", label: "电话" },
          { key: "address", label: "地址" },
          { key: "remark", label: "备注" },
        ]}
        fields={[
          { name: "name", label: "客户名称", required: true, maxLength: 100 },
          { name: "contact", label: "联系人", maxLength: 50 },
          { name: "phone", label: "电话", maxLength: 30 },
          { name: "address", label: "地址", maxLength: 200 },
          { name: "remark", label: "备注", maxLength: 200 },
        ]}
        rows={customers.map((c) => ({
          id: c.id,
          status: c.status,
          cells: {
            name: c.name,
            contact: c.contact ?? "",
            phone: c.phone ?? "",
            address: c.address ?? "",
            remark: c.remark ?? "",
          },
          formValues: {
            name: c.name,
            contact: c.contact ?? "",
            phone: c.phone ?? "",
            address: c.address ?? "",
            remark: c.remark ?? "",
          },
        }))}
        isAdmin={user.role === "admin"}
        saveAction={saveCustomerAction}
        toggleAction={toggleCustomerStatusAction}
      />
    </div>
  );
}
