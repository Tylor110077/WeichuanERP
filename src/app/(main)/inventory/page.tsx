import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "库存查询 - 维川进销存" };

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; warnOnly?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const q = params.q?.trim();
  const warnOnly = params.warnOnly === "1";

  const products = await prisma.product.findMany({
    where: {
      ...(q
        ? { OR: [{ name: { contains: q } }, { code: { contains: q } }] }
        : {}),
    },
    orderBy: { code: "asc" },
    include: {
      unit: { select: { name: true } },
      category: { select: { name: true } },
    },
  });

  // 最近进价：各商品最近一次非作废进货（purchase_in 流水 → 单据状态过滤）
  const activePoNos = await prisma.purchaseOrder.findMany({
    where: { status: { not: "voided" } },
    select: { orderNo: true },
  });
  const purchaseIns = await prisma.stockMovement.findMany({
    where: {
      bizType: "purchase_in",
      bizOrderNo: { in: activePoNos.map((o) => o.orderNo) },
    },
    orderBy: { createdAt: "desc" },
    select: { productId: true, unitCost: true },
  });
  const lastPrice = new Map<number, number>();
  for (const m of purchaseIns) {
    if (!lastPrice.has(m.productId)) lastPrice.set(m.productId, Number(m.unitCost));
  }

  const rows = products
    .map((p) => {
      const qty = Number(p.stockQty);
      const minStock = Number(p.minStock);
      const warning = p.status === 1 && minStock > 0 && qty < minStock;
      const negative = qty < 0;
      return { p, qty, minStock, warning, negative };
    })
    .filter((r) => !warnOnly || r.warning);

  const warningCount = products.filter((p) => {
    const qty = Number(p.stockQty);
    return p.status === 1 && Number(p.minStock) > 0 && qty < Number(p.minStock);
  }).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">库存查询</h1>
        {warningCount > 0 && (
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700">
            预警商品 {warningCount} 个
          </span>
        )}
      </div>

      <form className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <input
          name="q"
          type="text"
          placeholder="编码 / 名称搜索"
          defaultValue={q}
          className="w-52 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
        <label className="flex items-center gap-1 text-sm text-gray-600">
          <input type="checkbox" name="warnOnly" value="1" defaultChecked={warnOnly} className="h-4 w-4" />
          只看库存预警
        </label>
        <button type="submit" className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200">
          筛选
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">编码</th>
              <th className="px-4 py-3 font-medium">名称</th>
              <th className="px-4 py-3 font-medium">分类</th>
              <th className="px-4 py-3 font-medium">单位</th>
              <th className="px-4 py-3 text-right font-medium">库存数量</th>
              <th className="px-4 py-3 text-right font-medium">成本金额</th>
              <th className="px-4 py-3 text-right font-medium">均价</th>
              <th className="px-4 py-3 text-right font-medium">最近进价</th>
              <th className="px-4 py-3 text-right font-medium">预警线</th>
              <th className="px-4 py-3 font-medium">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                  暂无数据
                </td>
              </tr>
            )}
            {rows.map(({ p, qty, minStock, warning, negative }) => (
              <tr key={p.id} className={warning ? "bg-amber-50/60" : ""}>
                <td className="px-4 py-2.5 text-gray-600">{p.code}</td>
                <td className="px-4 py-2.5 text-gray-900">{p.name}</td>
                <td className="px-4 py-2.5 text-gray-600">{p.category?.name ?? "—"}</td>
                <td className="px-4 py-2.5 text-gray-600">{p.unit.name}</td>
                <td className={`px-4 py-2.5 text-right font-medium ${negative ? "text-red-600" : "text-gray-900"}`}>
                  {qty.toFixed(3)}
                </td>
                <td className="px-4 py-2.5 text-right text-gray-900">¥{Number(p.stockAmount).toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right text-gray-600">¥{Number(p.avgCost).toFixed(4)}</td>
                <td className="px-4 py-2.5 text-right text-gray-600">
                  {lastPrice.get(p.id) != null ? `¥${lastPrice.get(p.id)?.toFixed(2)}` : "—"}
                </td>
                <td className="px-4 py-2.5 text-right text-gray-600">{minStock.toFixed(3)}</td>
                <td className="px-4 py-2.5">
                  {warning && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">预警</span>}
                  {negative && (
                    <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">负库存</span>
                  )}
                  {!warning && !negative && (
                    <span className={`rounded-full px-2 py-0.5 text-xs ${p.status === 1 ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                      {p.status === 1 ? "正常" : "停用"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
