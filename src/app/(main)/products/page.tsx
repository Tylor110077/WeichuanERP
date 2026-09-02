import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { MasterDataManager } from "@/components/master-data-manager";
import { deleteProductAction, saveProductAction, toggleProductStatusAction } from "./actions";

export const metadata = { title: "商品管理 - 玮川进销存" };

export default async function ProductsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [products, units, categories] = await Promise.all([
    prisma.product.findMany({
      orderBy: { code: "asc" },
      include: {
        category: { select: { name: true } },
        unit: { select: { name: true } },
      },
    }),
    prisma.unit.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, status: true } }),
    prisma.productCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, status: true } }),
  ]);

  const unitOptions = units.map((u) => ({
    value: String(u.id),
    label: u.status === 1 ? u.name : `${u.name}（停用）`,
  }));
  const categoryOptions = categories.map((c) => ({
    value: String(c.id),
    label: c.status === 1 ? c.name : `${c.name}（停用）`,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">商品管理</h1>
      <MasterDataManager
        entityLabel="商品"
        columns={[
          { key: "code", label: "编码" },
          { key: "name", label: "名称" },
          { key: "spec", label: "规格" },
          { key: "manufacturer", label: "厂商" },
          { key: "category", label: "分类" },
          { key: "unit", label: "单位" },
          { key: "refPurchasePrice", label: "参考进价" },
          { key: "refSalePrice", label: "参考售价" },
          { key: "stockQty", label: "库存" },
          { key: "minStock", label: "预警线" },
        ]}
        fields={[
          { name: "name", label: "商品名称", required: true, maxLength: 100 },
          { name: "spec", label: "规格/型号", maxLength: 100 },
          { name: "manufacturer", label: "厂商（生产厂家）*，与供应商档案同名将作为自动补货来源", required: true, maxLength: 100, placeholder: "如：远东电缆、正泰电器" },
          {
            name: "categoryId",
            label: "分类",
            options: categoryOptions,
          },
          { name: "unitId", label: "单位", required: true, options: unitOptions },
          {
            name: "refPurchasePrice",
            label: "参考进价",
            type: "number",
            step: "0.01",
            placeholder: "0.00",
          },
          {
            name: "refSalePrice",
            label: "参考售价",
            type: "number",
            step: "0.01",
            placeholder: "0.00",
          },
          {
            name: "minStock",
            label: "库存预警线",
            type: "number",
            step: "0.001",
            placeholder: "0",
          },
        ]}
        rows={products.map((p) => ({
          id: p.id,
          status: p.status,
          cells: {
            code: p.code,
            name: p.name,
            spec: p.spec ?? "",
            manufacturer: p.manufacturer || "（未填写）",
            category: p.category?.name ?? "",
            unit: p.unit.name,
            refPurchasePrice: Number(p.refPurchasePrice).toFixed(2),
            refSalePrice: Number(p.refSalePrice).toFixed(2),
            stockQty: Number(p.stockQty).toFixed(3),
            minStock: Number(p.minStock).toFixed(3),
          },
          formValues: {
            name: p.name,
            spec: p.spec ?? "",
            manufacturer: p.manufacturer,
            categoryId: p.categoryId != null ? String(p.categoryId) : "",
            unitId: String(p.unitId),
            refPurchasePrice: p.refPurchasePrice.toString(),
            refSalePrice: p.refSalePrice.toString(),
            minStock: p.minStock.toString(),
          },
        }))}
        isAdmin={user.role === "admin"}
        saveAction={saveProductAction}
        toggleAction={toggleProductStatusAction}
        deleteAction={deleteProductAction}
      />
    </div>
  );
}
