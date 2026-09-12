import { redirect } from "next/navigation";
import { NoPermission } from "@/components/empty-state";
import { btnSecondary } from "@/lib/ui";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NewSaleForm } from "./new-sale-form";
import { recentCustomersForOrder, recentProductsForOrder } from "./search-actions";

export const metadata = { title: "销售开单 - 玮川进销存" };

/**
 * 销售开单。
 *
 * 规模化要点（见 docs/系统梳理/07-规模化设计.md 的 S1）：
 * 商品与客户只下发"最近往来的 N 条"，用户输入关键词时走 server action 搜索，
 * 价格参考值在选中商品后按需查询——首屏负载不随商品/客户总量增长。
 */
export default async function NewSaleOrderPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "boss") {
    return (
      <NoPermission text="无权限开售卖单（管理员/业务员）" />
    );
  }

  const canSeeCost = user.role !== "sales";

  const [recentProducts, recentCustomers, suppliers, units, categories, groups, tags] =
    await Promise.all([
      recentProductsForOrder(),
      recentCustomersForOrder(),
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
    ]);

  const supplierMap = new Map(suppliers.map((s) => [s.id, s.name]));

  const productOptions = recentProducts.map((p) => ({
    id: p.id,
    label: `${p.code} ${p.name}`,
    code: p.code,
    name: p.name,
    spec: p.spec,
    manufacturer: p.manufacturer,
    unitName: p.unitName,
    stockQty: p.stockQty,
    avgCost: p.avgCost,
    refSalePrice: p.refSalePrice,
    lastSupplierId: p.lastSupplierId,
    lastSupplierName: p.lastSupplierId != null ? supplierMap.get(p.lastSupplierId) ?? "" : "",
    lastSupplyPrice: p.lastSupplyPrice,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">销售开单</h1>
        <Link href="/sale-orders" className={btnSecondary}>
          ← 返回售卖单
        </Link>
      </div>
      <NewSaleForm
        customers={recentCustomers}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        products={productOptions}
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        customerGroups={groups.map((g) => ({ id: g.id, name: g.name }))}
        customerTags={tags.map((t) => ({ id: t.id, name: t.name }))}
        canCreateCustomer={user.role === "admin"}
        canCreateProduct={user.role === "admin"}
        canSeeCost={canSeeCost}
      />
    </div>
  );
}
