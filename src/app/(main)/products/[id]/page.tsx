import { redirect, notFound } from "next/navigation";
import { NoPermission } from "@/components/empty-state";
import Link from "next/link";
import { btnSecondary } from "@/lib/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { initials } from "@/lib/pinyin";
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
      <NoPermission text="无权限（仅管理员可维护商品）" />
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">
          编辑商品（{product.code}）
        </h1>
        <Link href="/products" className={btnSecondary}>
          ← 返回商品列表
        </Link>
      </div>
      <EntityForm
        fields={[
          { name: "name", label: "商品名称 *", placeholder: "写全名称，如：BV 2.5平方 单芯铜线", required: true, maxLength: 100 },
          {
            name: "manufacturer",
            label: "厂家 *",
            placeholder: "缺货时自动向其补货，可当场新建",
            required: true,
            type: "manufacturer",
          },
          {
            name: "categoryId",
            label: "分类",
            type: "searchselect",
            noneLabel: "未分类",
            options: categories.map((c) => ({ value: String(c.id), label: c.status === 1 ? c.name : `${c.name}（停用）`, py: initials(c.name) })),
          },
          {
            name: "unitId",
            label: "单位 *",
            required: true,
            type: "searchselect",
            options: units.map((u) => ({ value: String(u.id), label: u.status === 1 ? u.name : `${u.name}（停用）`, py: initials(u.name) })),
          },
          { name: "refPurchasePrice", label: "参考进价", type: "number", step: "0.01" },
          { name: "minStock", label: "库存预警线", placeholder: "留空按 1 计", type: "number", step: "0.001" },
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
        manufacturerSuppliers={suppliers.map((x) => ({ id: x.id, name: x.name, py: initials(x.name) }))}
        onQuickCreateSupplier={createQuickSupplierAction}
      />
    </div>
  );
}
