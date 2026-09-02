import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { MasterDataManager } from "@/components/master-data-manager";
import {
  deleteCustomerGroupAction,
  saveCustomerGroupAction,
  toggleCustomerGroupStatusAction,
} from "../customers/actions";

export const metadata = { title: "客户组织 - 玮川进销存" };

export default async function CustomerGroupsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const groups = await prisma.customerGroup.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { customers: true } } },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">客户组织</h1>
      <MasterDataManager
        entityLabel="组织"
        columns={[
          { key: "name", label: "组织名称" },
          { key: "customerCount", label: "客户数" },
        ]}
        fields={[
          { name: "name", label: "组织名称", required: true, maxLength: 50, placeholder: "如：市直单位、县城经销商、批发市场" },
        ]}
        rows={groups.map((g) => ({
          id: g.id,
          status: g.status,
          cells: { name: g.name, customerCount: `${g._count.customers} 个` },
          formValues: { name: g.name },
        }))}
        isAdmin={user.role === "admin"}
        saveAction={saveCustomerGroupAction}
        toggleAction={toggleCustomerGroupStatusAction}
        deleteAction={deleteCustomerGroupAction}
      />
    </div>
  );
}
