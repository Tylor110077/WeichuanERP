import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NewSaleForm } from "./new-sale-form";

export const metadata = { title: "销售开单 - 维川进销存" };

export default async function NewSaleOrderPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "boss") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限开售卖单（管理员/业务员）
      </div>
    );
  }

  const products = await prisma.product.findMany({
    where: { status: 1 },
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      stockQty: true,
      unit: { select: { name: true } },
      refSalePrice: true,
      refPurchasePrice: true,
    },
  });

  const [customers, suppliers, lastPurchases] = await Promise.all([
    prisma.customer.findMany({
      where: { status: 1 },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.supplier.findMany({
      where: { status: 1 },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // 每个商品最近一次非作废进货单（用于预填自动补货的供应商 / 进价）
    prisma.purchaseOrderItem.findMany({
      where: {
        productId: { in: products.map((p) => p.id) },
        purchaseOrder: { status: { not: "voided" } },
      },
      orderBy: { purchaseOrder: { createdAt: "desc" } },
      select: {
        productId: true,
        unitPrice: true,
        purchaseOrder: { select: { supplierId: true, createdAt: true } },
      },
    }),
  ]);

  const lastByProduct = new Map<number, { supplierId: number; price: number }>();
  for (const lp of lastPurchases) {
    if (!lastByProduct.has(lp.productId)) {
      lastByProduct.set(lp.productId, {
        supplierId: lp.purchaseOrder.supplierId,
        price: Number(lp.unitPrice),
      });
    }
  }

  const supplierMap = new Map(suppliers.map((s) => [s.id, s.name]));

  const productOptions = products.map((p) => {
    const last = lastByProduct.get(p.id);
    return {
      id: p.id,
      label: `${p.code} ${p.name}`,
      unitName: p.unit.name,
      stockQty: Number(p.stockQty),
      refSalePrice: Number(p.refSalePrice),
      lastSupplierId: last?.supplierId ?? null,
      lastSupplierName: last ? supplierMap.get(last.supplierId) ?? "" : "",
      lastSupplyPrice: last?.price ?? Number(p.refPurchasePrice),
    };
  });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">销售开单</h1>
      <NewSaleForm
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        products={productOptions}
      />
    </div>
  );
}
