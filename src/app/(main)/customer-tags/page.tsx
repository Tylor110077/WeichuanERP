import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { MasterDataManager } from "@/components/master-data-manager";
import {
  deleteCustomerTagAction,
  saveCustomerTagAction,
  toggleCustomerTagStatusAction,
} from "../customers/actions";

export const metadata = { title: "客户标签 - 玮川进销存" };

export default async function CustomerTagsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const tags = await prisma.customerTag.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { links: true } } },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">客户标签</h1>
      <MasterDataManager
        entityLabel="标签"
        columns={[
          { key: "name", label: "标签名称" },
          { key: "customerCount", label: "客户数" },
        ]}
        fields={[
          { name: "name", label: "标签名称", required: true, maxLength: 30, placeholder: "如：重点客户、欠款、批发、月结" },
        ]}
        rows={tags.map((t) => ({
          id: t.id,
          status: t.status,
          cells: { name: t.name, customerCount: `${t._count.links} 个` },
          formValues: { name: t.name },
        }))}
        isAdmin={user.role === "admin"}
        saveAction={saveCustomerTagAction}
        toggleAction={toggleCustomerTagStatusAction}
        deleteAction={deleteCustomerTagAction}
      />
    </div>
  );
}
