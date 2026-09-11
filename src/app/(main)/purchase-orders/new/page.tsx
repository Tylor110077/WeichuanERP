import { redirect } from "next/navigation";
import { NoPermission } from "@/components/empty-state";
import { btnSecondary } from "@/lib/ui";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
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

  const [suppliers, products] = await Promise.all([
    prisma.supplier.findMany({
      where: { status: 1 },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.product.findMany({
      where: { status: 1 },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        unitId: true,
        unit: { select: { name: true } },
        refPurchasePrice: true,
      },
    }),
  ]);

  // 最近一次实际进价（同商品分批进价不同，开单预填最近成交价）
  const lastPurchases = await prisma.purchaseOrderItem.findMany({
    where: { purchaseOrder: { status: { not: "voided" } } },
    orderBy: { purchaseOrder: { createdAt: "desc" } },
    select: { productId: true, unitPrice: true },
  });
  const lastPriceByProduct = new Map<number, number>();
  for (const lp of lastPurchases) {
    if (!lastPriceByProduct.has(lp.productId)) {
      lastPriceByProduct.set(lp.productId, Number(lp.unitPrice));
    }
  }

  const productOptions = products.map((p) => ({
    id: p.id,
    label: `${p.code} ${p.name}`,
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
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        products={productOptions}
      />
    </div>
  );
}
