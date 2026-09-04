import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { EntityForm } from "@/components/entity-form";
import { saveProductAction } from "../actions";
import { createQuickSupplierAction } from "../../suppliers/actions";

export const metadata = { title: "编辑商品 - 玮川进销存" };

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限（仅管理员可维护商品）
      </div>
    );
  }

  const { id: idRaw } = await params;
  const id = Number(idRaw);
  const product = Number.isInteger(id)
    ? await prisma.product.findUnique({ where: { id } })
    : null;
  if (!product) notFound();

  const [units, categories, suppliers] = await Promise.all([
    prisma.unit.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, status: true } }),
    prisma.productCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, status: true } }),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">
        编辑商品（{product.code}）
      </h1>
      <EntityForm
        fields={[
          { name: "name", label: "商品名称（完整名称，含规格）*", required: true, maxLength: 100 },
          {
            name: "manufacturer",
            label: "厂商（生产厂家）*，选择供应商档案，可当场新建",
            required: true,
            type: "manufacturer",
          },
          {
            name: "categoryId",
            label: "分类",
            type: "select",
            options: [
              { value: "", label: "未分类" },
              ...categories.map((c) => ({ value: String(c.id), label: c.status === 1 ? c.name : `${c.name}（停用）` })),
            ],
          },
          {
            name: "unitId",
            label: "单位 *",
            required: true,
            type: "select",
            options: units.map((u) => ({ value: String(u.id), label: u.status === 1 ? u.name : `${u.name}（停用）` })),
          },
          { name: "refPurchasePrice", label: "参考进价", type: "number", step: "0.01" },
          { name: "minStock", label: "库存预警线（默认 1）", type: "number", step: "0.001" },
        ]}
        initial={{
          name: product.name,
          manufacturer: product.manufacturer,
          categoryId: product.categoryId != null ? String(product.categoryId) : "",
          unitId: String(product.unitId),
          refPurchasePrice: product.refPurchasePrice.toString(),
          minStock: product.minStock.toString() === "0" ? "1" : product.minStock.toString(),
        }}
        initialId={product.id}
        saveAction={saveProductAction}
        submitLabel="保存修改"
        manufacturerSuppliers={suppliers.map((x) => ({ id: x.id, name: x.name }))}
        onQuickCreateSupplier={createQuickSupplierAction}
      />
      <Link href="/products" className="text-sm text-gray-500 hover:underline">
        ← 返回商品列表
      </Link>
    </div>
  );
}
