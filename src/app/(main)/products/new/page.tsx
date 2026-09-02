import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { EntityForm } from "@/components/entity-form";
import { saveProductAction } from "../actions";

export const metadata = { title: "新建商品 - 玮川进销存" };

export default async function NewProductPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限（仅管理员可维护商品）
      </div>
    );
  }

  const [units, categories] = await Promise.all([
    prisma.unit.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.productCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">新建商品（编码自动生成）</h1>
      <EntityForm
        fields={[
          { name: "name", label: "商品名称 *", required: true, maxLength: 100 },
          { name: "spec", label: "规格/型号", maxLength: 100 },
          {
            name: "manufacturer",
            label: "厂商（生产厂家）*",
            required: true,
            maxLength: 100,
            placeholder: "与供应商档案同名将自动作为补货来源，如：远东电缆",
          },
          { name: "categoryId", label: "分类", type: "select", options: [{ value: "", label: "未分类" }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))] },
          { name: "unitId", label: "单位 *", required: true, type: "select", options: units.map((u) => ({ value: String(u.id), label: u.name })) },
          { name: "refPurchasePrice", label: "参考进价", type: "number", step: "0.01" },
          { name: "refSalePrice", label: "参考售价", type: "number", step: "0.01" },
          { name: "minStock", label: "库存预警线", type: "number", step: "0.001" },
        ]}
        saveAction={saveProductAction}
        submitLabel="创建商品"
      />
      <Link href="/products" className="text-sm text-gray-500 hover:underline">
        ← 返回商品列表
      </Link>
    </div>
  );
}
