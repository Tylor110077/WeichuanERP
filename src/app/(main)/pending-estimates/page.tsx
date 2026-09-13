import { redirect } from "next/navigation";
import Link from "next/link";
import { NoPermission } from "@/components/empty-state";
import { badgeDanger } from "@/lib/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { initials } from "@/lib/pinyin";
import { Pager } from "@/components/pager";
import { FillForm } from "./fill-form";

export const metadata = { title: "估价待补单 - 玮川进销存" };

/** 待补行会随估价单越积越多：一页 20 行 */
const PAGE_SIZE = 20;

/**
 * 估价待补单：开售卖单时只填了售价、进价与货源还没定的行，都在这里等着补。
 *
 * 补单做三件事：生成一张待收货的进货单、把成本写回原售卖单那一行、把商品的临时名与厂家补正。
 * 因为估价行不占库存、没参与移动加权成本，写回成本只影响那一张单自己的毛利，不会牵动别的单据。
 * 库存要等那张进货单「确认入库」才进——这一步仍走既有的入库逻辑。
 */
export default async function PendingEstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "sales") {
    return <NoPermission text="无权限查看估价待补单（管理员/老板）" />;
  }
  const canFill = user.role === "admin";

  const params = await searchParams;
  const where = { estimated: true, estimatedResolvedAt: null, saleOrder: { status: "confirmed" } } as const;
  const total = await prisma.saleOrderItem.count({ where });
  /** 页码夹在有效范围内：地址栏里乱填 page 也不会看到空白页 */
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(params.page) || 1), totalPages);

  const [items, suppliers] = await Promise.all([
    prisma.saleOrderItem.findMany({
      where,
      orderBy: { saleOrder: { createdAt: "desc" } },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        product: { select: { code: true, name: true, manufacturer: true } },
        unit: { select: { name: true } },
        saleOrder: {
          select: { id: true, orderNo: true, createdAt: true, customer: { select: { name: true } } },
        },
      },
    }),
    prisma.supplier.findMany({
      where: { status: 1 },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const supplierOptions = suppliers.map((s) => ({ id: s.id, name: s.name, py: initials(s.name) }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">
          估价待补单
          {total > 0 && <span className="ml-2 text-sm font-normal text-gray-500">共 {total} 行待补</span>}
        </h1>
        <Link href="/sale-orders" className="text-xs text-gray-500 hover:underline">
          ← 返回售卖单
        </Link>
      </div>

      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        这些行是开售卖单时只填了售价的：当时价格与货源还没定，所以没占库存、也没自动进货。
        问到价格后在这里填<b>厂家与进价</b>并点「补单」——系统会生成一张待收货的进货单，
        并把成本写回原单那一行（原单毛利随之变准）。
        进货单要再到「进货单」里点一次「确认入库」，库存才算进。
      </p>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-12 text-center text-sm text-gray-400">
          没有待补的估价行。<br />
          <span className="text-xs">
            开售卖单时把某一行的「估价」打开，它就会出现在这里。
          </span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[68rem] divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-medium">开单时间</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">原售卖单</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">客户</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">品名（可改）</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">数量</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">单位</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">售价</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">金额</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">补厂家与进价</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                    {it.saleOrder.createdAt.toLocaleDateString("zh-CN")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Link href={`/sale-orders/${it.saleOrder.id}`} className="text-blue-600 hover:underline">
                      {it.saleOrder.orderNo}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-900">{it.saleOrder.customer.name}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-900">
                    <span className="text-gray-400">{it.product.code}</span> {it.product.name}
                    {it.product.manufacturer ? (
                      <span className="ml-1 text-xs text-gray-500">{it.product.manufacturer}</span>
                    ) : (
                      <span className={`ml-1 ${badgeDanger}`}>未填厂家</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{Number(it.quantity).toFixed(3)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{it.unit.name}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">¥{Number(it.unitPrice).toFixed(2)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">¥{Number(it.amount).toFixed(2)}</td>
                  <td className="px-4 py-2.5">
                    {canFill ? (
                      <FillForm itemId={it.id} productName={it.product.name} suppliers={supplierOptions} />
                    ) : (
                      <span className="text-xs text-gray-400">由管理员补单</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 只有一页时 Pager 自身会返回 null，不用在这里判断 */}
      <Pager page={page} totalPages={totalPages} hrefFor={(p) => (p > 1 ? `/pending-estimates?page=${p}` : "/pending-estimates")} />
    </div>
  );
}
