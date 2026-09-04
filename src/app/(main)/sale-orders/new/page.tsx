import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NewSaleForm } from "./new-sale-form";

export const metadata = { title: "销售开单 - 玮川进销存" };

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
      spec: true,
      manufacturer: true,
      stockQty: true,
      unit: { select: { name: true } },
      refSalePrice: true,
      refPurchasePrice: true,
    },
  });

  const [customers, suppliers, units, categories, groups, tags, lastPurchases] = await Promise.all([
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
    prisma.unit.findMany({
      where: { status: 1 },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.productCategory.findMany({
      where: { status: 1 },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.customerGroup.findMany({
      where: { status: 1 },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.customerTag.findMany({
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

  // 最近一次成交售价（每笔销售单价可能不同，预填最近成交价，参考售价兜底）
  const lastSaleItems = await prisma.saleOrderItem.findMany({
    where: { saleOrder: { status: "confirmed" } },
    orderBy: { saleOrder: { createdAt: "desc" } },
    select: { productId: true, unitPrice: true },
  });
  const lastSalePriceByProduct = new Map<number, number>();
  for (const si of lastSaleItems) {
    if (!lastSalePriceByProduct.has(si.productId)) {
      lastSalePriceByProduct.set(si.productId, Number(si.unitPrice));
    }
  }

  const supplierMap = new Map(suppliers.map((s) => [s.id, s.name]));
  // 厂商优先：商品档案的“厂商”名称匹配到供应商档案时，自动补货商默认取该供应商
  const supplierIdByName = new Map<string, number>();
  for (const s of suppliers) {
    supplierIdByName.set(s.name, s.id);
  }

  const productOptions = products.map((p) => {
    const last = lastByProduct.get(p.id);
    const mfrSupplierId = supplierIdByName.get(p.manufacturer.trim()) ?? null;
    const autoSupplierId = mfrSupplierId ?? last?.supplierId ?? null;
    return {
      id: p.id,
      label: `${p.code} ${p.name}`,
      code: p.code,
      name: p.name,
      spec: p.spec ?? "",
      manufacturer: p.manufacturer,
      unitName: p.unit.name,
      stockQty: Number(p.stockQty),
      refSalePrice: lastSalePriceByProduct.get(p.id) ?? Number(p.refSalePrice), // 预填最近成交价
      lastSupplierId: autoSupplierId,
      lastSupplierName: last ? supplierMap.get(last.supplierId) ?? "" : "",
      lastSupplyPrice: last?.price ?? Number(p.refPurchasePrice),
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">销售开单</h1>
        <Link href="/sale-orders" className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          ← 返回售卖单
        </Link>
      </div>
      <NewSaleForm
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        products={productOptions}
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        customerGroups={groups.map((g) => ({ id: g.id, name: g.name }))}
        customerTags={tags.map((t) => ({ id: t.id, name: t.name }))}
        canCreateCustomer={user.role === "admin"}
        canCreateProduct={user.role === "admin"}
      />
    </div>
  );
}
