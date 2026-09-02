import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { MasterDataManager } from "@/components/master-data-manager";
import {
  deleteCategoryAction,
  saveCategoryAction,
  toggleCategoryStatusAction,
} from "./actions";

export const metadata = { title: "商品分类 - 玮川进销存" };

export default async function CategoriesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const categories = await prisma.productCategory.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, status: true },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">商品分类</h1>
      <MasterDataManager
        entityLabel="分类"
        columns={[{ key: "name", label: "分类名称" }]}
        fields={[
          {
            name: "name",
            label: "分类名称",
            required: true,
            maxLength: 50,
            placeholder: "如：五金、线材、板材",
          },
        ]}
        rows={categories.map((c) => ({
          id: c.id,
          status: c.status,
          cells: { name: c.name },
          formValues: { name: c.name },
        }))}
        isAdmin={user.role === "admin"}
        saveAction={saveCategoryAction}
        toggleAction={toggleCategoryStatusAction}
        deleteAction={deleteCategoryAction}
      />
    </div>
  );
}
