import { redirect } from "next/navigation";
import { NoPermission } from "@/components/empty-state";
import { btnSecondary } from "@/lib/ui";
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
      <NoPermission text="无权限开售卖单（管理员/业务员）" />
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
      avgCost: true, // 移动加权均价（开单时参考成本）
      unit: { select: { name: true } },
      refSalePrice: true,
      refPurchasePrice: true,
    },
  });

  const [customers, suppliers, units, categories, groups, tags, lastPurchases] = await Promise.all([
    prisma.customer.findMany({
      where: { status: 1 },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        group: { select: { name: true } },
        tagLinks: { select: { tag: { select: { name: true } } } },
      },
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
    // 每个商品最近一次非作废进货单（用于预填自动补货的厂家 / 进价）
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

  // 同一客户 + 同一商品的最近成交价（开单参考："上次卖给该客户 XX 元"）
  const lastCustomerSaleItems = await prisma.saleOrderItem.findMany({
    where: { saleOrder: { status: "confirmed" } },
    orderBy: { saleOrder: { createdAt: "desc" } },
    select: {
      productId: true,
      unitPrice: true,
      saleOrder: { select: { customerId: true, createdAt: true } },
    },
  });
  const lastCustomerPrice = new Map<string, number>();
  for (const si of lastCustomerSaleItems) {
    const key = `${si.saleOrder.customerId}-${si.productId}`;
    if (!lastCustomerPrice.has(key)) lastCustomerPrice.set(key, Number(si.unitPrice));
  }

  const supplierMap = new Map(suppliers.map((s) => [s.id, s.name]));
  // 厂家优先：商品档案的“厂家”名称匹配到厂家档案时，自动补货商默认取该厂家
  const supplierIdByName = new Map<string, number>();
  for (const s of suppliers) {
    supplierIdByName.set(s.name, s.id);
  }

  // 成本可见性与单据详情页同口径：业务员不可见成本/毛利，
  // 因此这里连数据都不下发（只靠前端隐藏等于把成本发到了浏览器）。
  const canSeeCost = user.role !== "sales";

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
      avgCost: canSeeCost ? Number(p.avgCost) : 0, // 当前移动加权均价（仅供可见成本的角色的开单参考）
      refSalePrice: lastSalePriceByProduct.get(p.id) ?? Number(p.refSalePrice), // 预填最近成交价
      lastSupplierId: autoSupplierId,
      lastSupplierName: last ? supplierMap.get(last.supplierId) ?? "" : "",
      lastSupplyPrice: last?.price ?? Number(p.refPurchasePrice),
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">销售开单</h1>
        <Link href="/sale-orders" className={btnSecondary}>
          ← 返回售卖单
        </Link>
      </div>
      <NewSaleForm
        customers={customers.map((c) => ({ id: c.id, name: c.name, groupName: c.group?.name ?? "", tagNames: c.tagLinks.map((l) => l.tag.name) }))}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        products={productOptions}
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        customerGroups={groups.map((g) => ({ id: g.id, name: g.name }))}
        customerTags={tags.map((t) => ({ id: t.id, name: t.name }))}
        lastCustomerPrices={Object.fromEntries(lastCustomerPrice)}
        canCreateCustomer={user.role === "admin"}
        canCreateProduct={user.role === "admin"}
        canSeeCost={canSeeCost}
      />
    </div>
  );
}
