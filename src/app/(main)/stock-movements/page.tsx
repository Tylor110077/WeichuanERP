import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "库存流水 - 维川进销存" };

const PAGE_SIZE = 20;

const BIZ_TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  purchase_in: { label: "进货入库", cls: "bg-green-50 text-green-700" },
  sale_out: { label: "销售出库", cls: "bg-blue-50 text-blue-700" },
  purchase_return_out: { label: "进货退货", cls: "bg-orange-50 text-orange-700" },
  sale_return_in: { label: "销售退货", cls: "bg-teal-50 text-teal-700" },
  void_reverse: { label: "作废冲回", cls: "bg-gray-100 text-gray-600" },
};

export default async function StockMovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; productId?: string; bizType?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "sales") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
        无权限访问库存流水（管理员/老板）
      </div>
    );
  }

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const productId = params.productId ? Number(params.productId) : undefined;
  const bizType = params.bizType || undefined;

  const where = {
    ...(productId ? { productId } : {}),
    ...(bizType ? { bizType: bizType as "purchase_in" | "sale_out" | "purchase_return_out" | "sale_return_in" | "void_reverse" } : {}),
  };

  const [total, movements, products] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { product: { select: { code: true, name: true } } },
    }),
    prisma.product.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);

  const operatorMap = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: [...new Set(movements.map((m) => m.operatorId))] } },
        select: { id: true, displayName: true },
      })
    ).map((u) => [u.id, u.displayName])
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">库存流水</h1>

      <form className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <select name="productId" defaultValue={productId ?? ""} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">全部商品</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} {p.name}
            </option>
          ))}
        </select>
        <select name="bizType" defaultValue={bizType ?? ""} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">全部类型</option>
          {Object.entries(BIZ_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200">
          筛选
        </button>
        <span className="text-xs text-gray-500">共 {total} 条</span>
      </form>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">时间</th>
              <th className="px-4 py-3 font-medium">商品</th>
              <th className="px-4 py-3 font-medium">类型</th>
              <th className="px-4 py-3 text-right font-medium">变动数量</th>
              <th className="px-4 py-3 text-right font-medium">变动前</th>
              <th className="px-4 py-3 text-right font-medium">变动后</th>
              <th className="px-4 py-3 text-right font-medium">成本单价</th>
              <th className="px-4 py-3 font-medium">来源单据</th>
              <th className="px-4 py-3 font-medium">操作人</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {movements.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                  暂无流水
                </td>
              </tr>
            )}
            {movements.map((m) => {
              const meta = BIZ_TYPE_LABELS[m.bizType];
              return (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                    {m.createdAt.toLocaleString("zh-CN")}
                  </td>
                  <td className="px-4 py-2.5 text-gray-900">
                    {m.product.code} {m.product.name}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${meta.cls}`}>{meta.label}</span>
                  </td>
                  <td className={`px-4 py-2.5 text-right font-medium ${Number(m.changeQty) < 0 ? "text-red-600" : "text-green-700"}`}>
                    {Number(m.changeQty) > 0 ? "+" : ""}
                    {Number(m.changeQty).toFixed(3)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{Number(m.beforeQty).toFixed(3)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{Number(m.afterQty).toFixed(3)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">¥{Number(m.unitCost).toFixed(4)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{m.bizOrderNo}</td>
                  <td className="px-4 py-2.5 text-gray-600">{operatorMap.get(m.operatorId) ?? m.operatorId}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex items-center gap-3 border-t border-gray-100 px-4 py-3 text-sm">
            {page > 1 ? (
              <Link href={buildHref(page - 1)} className="text-blue-600 hover:underline">上一页</Link>
            ) : (
              <span className="text-gray-400">上一页</span>
            )}
            <span className="text-gray-600">第 {page} / {totalPages} 页</span>
            {page < totalPages ? (
              <Link href={buildHref(page + 1)} className="text-blue-600 hover:underline">下一页</Link>
            ) : (
              <span className="text-gray-400">下一页</span>
            )}
          </div>
        )}
      </div>
    </div>
  );

  function buildHref(p: number): string {
    const sp = new URLSearchParams();
    if (productId) sp.set("productId", String(productId));
    if (bizType) sp.set("bizType", bizType);
    sp.set("page", String(p));
    return `/stock-movements?${sp.toString()}`;
  }
}
