import { redirect } from "next/navigation";
import { FilterForm } from "@/components/filter-form";
import { EmptyState, NoPermission } from "@/components/empty-state";
import { btnSecondary, inputBase } from "@/lib/ui";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { initials } from "@/lib/pinyin";
import { DateShortcuts } from "@/components/date-shortcuts";
import { SearchSelect } from "@/components/search-select";

export const metadata = { title: "库存流水 - 玮川进销存" };

const PAGE_SIZE = 20;

/** 业务类型 → 单号归属的单据详情页前缀（退货/作废冲回不在此跳转） */
const ORDER_PATH: Record<string, string> = {
  purchase_in: "/purchase-orders",
  sale_out: "/sale-orders",
};

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
  searchParams: Promise<{ page?: string; productId?: string; bizType?: string; from?: string; to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "sales") {
    return (
      <NoPermission text="无权限访问库存流水（管理员/老板）" />
    );
  }

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const { gte, lte } = dateRange(params.from, params.to);
  const productId = params.productId ? Number(params.productId) : undefined;
  const bizType = params.bizType || undefined;

  const where = {
    ...(productId ? { productId } : {}),
    ...(bizType ? { bizType: bizType as "purchase_in" | "sale_out" | "purchase_return_out" | "sale_return_in" | "void_reverse" } : {}),
    createdAt: { gte, lte },
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
    // 带上厂家：同名商品可能来自不同厂家（金牛/华旗都有 YJV 3*2.5），筛选下拉里要标出来
    prisma.product.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true, manufacturer: true } }),
  ]);

  // 单号 → 单据详情：一次查出本页涉及的进货/售卖单 id，行内单号可直接点开
  const orderNos = [...new Set(movements.map((m) => m.bizOrderNo))];
  const [poIds, soIds] = await Promise.all([
    prisma.purchaseOrder.findMany({ where: { orderNo: { in: orderNos } }, select: { id: true, orderNo: true } }),
    prisma.saleOrder.findMany({ where: { orderNo: { in: orderNos } }, select: { id: true, orderNo: true } }),
  ]);
  const orderHrefMap = new Map<string, string>([
    ...poIds.map((o) => [o.orderNo, `/purchase-orders/${o.id}`] as const),
    ...soIds.map((o) => [o.orderNo, `/sale-orders/${o.id}`] as const),
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">
          库存流水
          {productId ? <span className="ml-2 text-xs font-normal text-gray-400">已筛选单个商品</span> : null}
        </h1>
        <div className="flex items-center gap-3">
          {productId ? (
            <>
              <Link href={`/inventory?batch=${productId}`} className="whitespace-nowrap text-xs text-blue-600 hover:underline">
                ← 回库存看批次
              </Link>
              <Link href={`/price-analysis?productId=${productId}`} className="whitespace-nowrap text-xs text-blue-600 hover:underline">
                看价格走势
              </Link>
            </>
          ) : null}
          <Link href="/inventory" className={btnSecondary}>
            ← 回库存查询
          </Link>
        </div>
      </div>

      <DateShortcuts basePath="/stock-movements" extraQuery={{ productId: productId ? String(productId) : "", bizType: bizType ?? "" }} />

      <FilterForm className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <SearchSelect
          name="productId"
          options={products.map((p) => ({
            value: String(p.id),
            label: `${p.code} ${p.name}（${p.manufacturer || "未填厂家"}）`,
            py: initials(`${p.code} ${p.name} ${p.manufacturer}`),
          }))}
          defaultValue={productId != null ? String(productId) : ""}
          noneLabel="全部商品"
          placeholder="商品（可搜索）"
          className="w-60"
        />
        <input type="date" name="from" defaultValue={params.from} className={`${inputBase}`} />
        <input type="date" name="to" defaultValue={params.to} className={`${inputBase}`} />
        <select name="bizType" defaultValue={bizType ?? ""} className={`${inputBase}`}>
          <option value="">全部类型</option>
          {Object.entries(BIZ_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <button type="submit" className={btnSecondary}>
          筛选
        </button>
        <span className="text-xs text-gray-500">共 {total} 条</span>
      </FilterForm>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-3 font-medium">时间</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">商品</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">类型</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">变动数量</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">变动前</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">变动后</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">成本单价</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">来源单据</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">操作人</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
            {movements.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <EmptyState title="该条件下没有库存变动" />
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
                    <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${meta.cls}`}>{meta.label}</span>
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${Number(m.changeQty) < 0 ? "text-red-600" : "text-green-700"}`}>
                    {Number(m.changeQty) > 0 ? "+" : ""}
                    {Number(m.changeQty).toFixed(3)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">{Number(m.beforeQty).toFixed(3)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">{Number(m.afterQty).toFixed(3)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">¥{Number(m.unitCost).toFixed(4)}</td>
                  <td className="px-4 py-2.5">
                    {ORDER_PATH[m.bizType] && orderHrefMap.has(m.bizOrderNo) ? (
                      <Link href={orderHrefMap.get(m.bizOrderNo)!} className="text-blue-600 hover:underline">
                        {m.bizOrderNo}
                      </Link>
                    ) : (
                      <span className="text-gray-600">{m.bizOrderNo}</span>
                    )}
                  </td>
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
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
    sp.set("page", String(p));
    return `/stock-movements?${sp.toString()}`;
  }
}


function dateRange(from?: string, to?: string): { gte: Date; lte: Date } {
  const now = new Date();
  const gte = from && /^\d{4}-\d{2}-\d{2}$/.test(from)
    ? new Date(`${from}T00:00:00`)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const toDate = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T00:00:00`) : now;
  const lte = new Date(toDate.getTime());
  lte.setHours(23, 59, 59, 999);
  return { gte, lte };
}
