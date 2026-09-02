import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NewOrderForm } from "./new-order-form";

export const metadata = { title: "进货开单 - 维川进销存" };

export default async function NewPurchaseOrderPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "boss") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限开进货单（管理员/业务员）
      </div>
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

  const productOptions = products.map((p) => ({
    id: p.id,
    label: `${p.code} ${p.name}`,
    unitId: p.unitId,
    unitName: p.unit.name,
    refPrice: Number(p.refPurchasePrice),
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">进货开单</h1>
      <NewOrderForm
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        products={productOptions}
      />
    </div>
  );
}
