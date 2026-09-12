import { redirect } from "next/navigation";
import { NoPermission } from "@/components/empty-state";
import { btnSecondary } from "@/lib/ui";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { initials } from "@/lib/pinyin";
import { NewOrderForm } from "./new-order-form";

export const metadata = { title: "进货开单 - 玮川进销存" };

export default async function NewPurchaseOrderPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "boss") {
    return (
      <NoPermission text="无权限开进货单（管理员/业务员）" />
    );
  }

  // 首屏只带"最近往来"（最近进过货的厂家/商品，不足用最新建档补齐）：
  // 厂家与商品目录都可能上千，全量塞进页面会让开单页越来越重（与销售开单页同一套做法）。
  const RECENT_LIMIT = 40;
  const recentPoItems = await prisma.purchaseOrderItem.findMany({
    where: { purchaseOrder: { status: { not: "voided" } } },
    orderBy: { purchaseOrder: { createdAt: "desc" } },
    take: RECENT_LIMIT * 4,
    select: { productId: true, unitPrice: true, purchaseOrder: { select: { supplierId: true } } },
  });

  // 最近进过的商品（按最近使用排序，去重）+ 最近一次进价
  const recentProductIds: number[] = [];
  const lastPriceByProduct = new Map<number, number>();
  for (const it of recentPoItems) {
    if (!lastPriceByProduct.has(it.productId)) lastPriceByProduct.set(it.productId, Number(it.unitPrice));
    if (!recentProductIds.includes(it.productId) && recentProductIds.length < RECENT_LIMIT) {
      recentProductIds.push(it.productId);
    }
  }
  // 最近打过交道的厂家
  const recentSupplierIds: number[] = [];
  for (const it of recentPoItems) {
    const sid = it.purchaseOrder.supplierId;
    if (!recentSupplierIds.includes(sid) && recentSupplierIds.length < RECENT_LIMIT) recentSupplierIds.push(sid);
  }

  const [recentProducts, recentSuppliers, categories, units] = await Promise.all([
    prisma.product.findMany({
      where: { status: 1, id: { in: recentProductIds } },
      select: {
        id: true,
        code: true,
        name: true,
        manufacturer: true,
        unitId: true,
        unit: { select: { name: true } },
        refPurchasePrice: true,
      },
    }),
    prisma.supplier.findMany({
      where: { status: 1, id: { in: recentSupplierIds } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.productCategory.findMany({ where: { status: 1 }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.unit.findMany({ where: { status: 1 }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const byId = new Map(recentProducts.map((p) => [p.id, p]));
  const suppliers = recentSuppliers;
  const products = recentProductIds
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p);

  const productOptions = products.map((p) => ({
    id: p.id,
    label: `${p.code} ${p.name}（${p.manufacturer || "未填厂家"}）`,
    unitId: p.unitId,
    unitName: p.unit.name,
    refPrice: lastPriceByProduct.get(p.id) ?? Number(p.refPurchasePrice),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">进货开单</h1>
        <Link href="/purchase-orders" className={btnSecondary}>
          ← 返回进货单
        </Link>
      </div>
      <NewOrderForm
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name, py: initials(s.name) }))}
        products={productOptions}
        categories={categories.map((c) => ({ id: c.id, name: c.name, py: initials(c.name) }))}
        units={units.map((u) => ({ id: u.id, name: u.name, py: initials(u.name) }))}
      />
    </div>
  );
}
