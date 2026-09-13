import { redirect } from "next/navigation";
import Link from "next/link";
import { FilterForm } from "@/components/filter-form";
import { SearchInput } from "@/components/search-input";
import { btnPrimary, btnSecondary, inputBase, segActive, segIdle } from "@/lib/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { DraftResumeLink } from "@/components/draft-resume-link";
import { prisma } from "@/lib/prisma";
import { pinyinQuery } from "@/lib/pinyin";
import { initials } from "@/lib/pinyin";
import { DateShortcuts } from "@/components/date-shortcuts";
import { SearchSelect } from "@/components/search-select";
import { SaleOrderTable, type SaleOrderRow } from "./order-table";

export const metadata = { title: "售卖单 - 玮川进销存" };

const PAGE_SIZE = 20;

export default async function SaleOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; from?: string; to?: string; customerId?: string; q?: string; settle?: string; star?: string; mode?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = params.status || undefined;
  const customerId = params.customerId ? Number(params.customerId) : undefined;
  const q = params.q?.trim();
  const settle =
    params.settle === "settled" || params.settle === "unsettled" ? params.settle : undefined;
  const range = dateRange(params.from, params.to);
  /** 只看星标：星标是"重要/待跟进"的标记，列表要能一键筛出来 */
  const starredOnly = params.star === "1";
  /** 查看方式：按单据（可展开商品）/ 只看商品（把商品行平铺，不分单） */
  const mode = params.mode === "item" ? "item" : "order";

  // 款项结清筛选：未结清 = 应收 − 已收 − 未作废退货冲减 > 0（仅统计已开单）
  let settleIds: number[] | null = null;
  if (settle === "settled") {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT so.id FROM sale_orders so
      LEFT JOIN (
        SELECT sale_order_id, SUM(total_amount) AS t
        FROM sale_returns WHERE status = 'confirmed' GROUP BY sale_order_id
      ) sr ON sr.sale_order_id = so.id
      WHERE so.status = 'confirmed'
        AND (so.total_amount - so.received_amount - COALESCE(sr.t, 0)) <= 0`;
    settleIds = rows.map((r) => r.id);
  } else if (settle === "unsettled") {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT so.id FROM sale_orders so
      LEFT JOIN (
        SELECT sale_order_id, SUM(total_amount) AS t
        FROM sale_returns WHERE status = 'confirmed' GROUP BY sale_order_id
      ) sr ON sr.sale_order_id = so.id
      WHERE so.status = 'confirmed'
        AND (so.total_amount - so.received_amount - COALESCE(sr.t, 0)) > 0`;
    settleIds = rows.map((r) => r.id);
  }

  const where = {
    ...(status ? { status: status as "confirmed" | "voided" } : {}),
    ...(customerId ? { customerId } : {}),
    // 单据号 + 客户名（中文或拼音首字母，如 zjw 找到张敬玮的单）
    ...(q
      ? {
          OR: [
            { orderNo: { contains: q } },
            { customer: { name: { contains: q } } },
            { customer: { searchPinyin: { contains: pinyinQuery(q) } } },
          ],
        }
      : {}),
    ...(settleIds ? { id: { in: settleIds } } : {}),
    ...(starredOnly ? { starred: true } : {}),
    createdAt: { gte: range.gte, lte: range.lte },
    ...(user.role === "sales" ? { operatorId: user.id } : {}),
  };

  const [total, orders, customers] = await Promise.all([
    prisma.saleOrder.count({ where }),
    prisma.saleOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        customer: { select: { name: true } },
        operator: { select: { displayName: true, role: true } },
        returns: { where: { status: "confirmed" }, select: { totalAmount: true } },
        // 行内展开要看商品，所以把商品行一起带出来
        items: {
          include: {
            product: { select: { code: true, name: true } },
            unit: { select: { name: true } },
          },
        },
      },
    }),
    prisma.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 只看商品：把筛选出的单据里的商品行平铺出来（不分单），同样分页
  const itemWhere = { saleOrder: where };
  const [itemTotal, itemRows, itemSum] =
    mode === "item"
      ? await Promise.all([
          prisma.saleOrderItem.count({ where: itemWhere }),
          prisma.saleOrderItem.findMany({
            where: itemWhere,
            orderBy: { saleOrder: { createdAt: "desc" } },
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
            include: {
              saleOrder: { select: { id: true, orderNo: true, createdAt: true, customer: { select: { name: true } } } },
              product: { select: { code: true, name: true } },
              unit: { select: { name: true } },
            },
          }),
          prisma.saleOrderItem.aggregate({ where: itemWhere, _sum: { quantity: true, amount: true } }),
        ])
      : [0, [], null];
  const itemPages = Math.max(1, Math.ceil(itemTotal / PAGE_SIZE));

  /** 传给列表组件的数据：都算好成纯值，组件只管展示与展开 */
  const saleOrderRows: SaleOrderRow[] = orders.map((o) => {
    const returned = o.returns.reduce((sum, r) => sum + Number(r.totalAmount), 0);
    return {
      id: o.id,
      orderNo: o.orderNo,
      customerName: o.customer.name,
      status: o.status,
      totalAmount: Number(o.totalAmount),
      receivedAmount: Number(o.receivedAmount),
      returned,
      operatorName: o.operator.displayName,
      operatorRole: o.operator.role,
      createdAtLabel: o.createdAt.toLocaleString("zh-CN"),
      starred: o.starred,
      needsReceipt: o.status !== "voided" && Number(o.totalAmount) - Number(o.receivedAmount) - returned > 0,
      items: o.items.map((it) => ({
        id: it.id,
        code: it.product.code,
        name: it.product.name,
        unit: it.unit.name,
        qty: Number(it.quantity),
        price: Number(it.unitPrice),
        amount: Number(it.amount),
        remark: it.remark ?? "",
      })),
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">售卖单</h1>
        {user.role !== "boss" && (
          <div className="flex flex-wrap items-center gap-2">
            <DraftResumeLink scope="sale" userId={user.id} href="/sale-orders/new" label="继续未完成的售卖单" />
            <Link
              href="/sale-orders/new"
              className={btnPrimary}
            >
              新建售卖单
            </Link>
          </div>
        )}
      </div>

      {/* 查看方式：按单据（可展开商品）/ 只看商品（把商品行平铺，不分单） */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">查看方式</span>
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm">
          <Link href={modeHref("order")} className={`px-3 py-1.5 ${mode === "order" ? segActive : segIdle}`}>
            按单据（可展开商品）
          </Link>
          <Link href={modeHref("item")} className={`px-3 py-1.5 ${mode === "item" ? segActive : segIdle}`}>
            只看商品（不分组）
          </Link>
        </div>
        {mode === "item" && itemSum && (
          <span className="text-xs text-gray-400">
            共 {itemTotal} 条商品行 ・ 总数量 {Number(itemSum._sum.quantity ?? 0).toFixed(3)} ・ 合计 ¥
            {Number(itemSum._sum.amount ?? 0).toFixed(2)}
          </span>
        )}
      </div>

      <DateShortcuts current={{ from: params.from, to: params.to }}
        basePath="/sale-orders"
        extraQuery={{
          customerId: customerId != null ? String(customerId) : "",
          q: q ?? "",
          status: status ?? "",
          settle: settle ?? "",
          star: starredOnly ? "1" : "",
        }}
      />

      <FilterForm className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <SearchInput
          name="q"
          type="text"
          placeholder="单据号 / 客户名"
          defaultValue={q}
          className={`${inputBase} w-40`}
        />
        <SearchSelect
          name="customerId"
          options={customers.map((c) => ({ value: String(c.id), label: c.name, py: initials(c.name) }))}
          defaultValue={customerId != null ? String(customerId) : ""}
          noneLabel="全部客户"
          placeholder="客户（可搜索）"
          className="w-52"
        />
        <input type="date" name="from" defaultValue={params.from} className={`${inputBase}`} />
        <input type="date" name="to" defaultValue={params.to} className={`${inputBase}`} />
        <select name="status" defaultValue={status ?? ""} className={`${inputBase}`}>
          <option value="">全部状态</option>
          <option value="confirmed">已开单</option>
          <option value="voided">已作废</option>
        </select>
        <select name="settle" defaultValue={settle ?? ""} className={`${inputBase}`}>
          <option value="">全部款项</option>
          <option value="unsettled">未结清</option>
          <option value="settled">已结清</option>
        </select>
        <select name="star" defaultValue={starredOnly ? "1" : ""} className={`${inputBase}`}>
          <option value="">全部单据</option>
          <option value="1">只看星标</option>
        </select>
        <button type="submit" className={btnSecondary}>
          筛选
        </button>
        <span className="text-xs text-gray-500">共 {total} 张</span>
      </FilterForm>

      {mode === "item" ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[72rem] divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-medium">日期</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">来源单据</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">客户</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">编码</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">品名</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">单位</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">数量</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">单价</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">金额</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">备注</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
              {itemRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-gray-400">
                    该条件下没有商品行
                  </td>
                </tr>
              )}
              {itemRows.map((it) => (
                <tr key={it.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600 tabular-nums">
                    {it.saleOrder.createdAt.toLocaleDateString("zh-CN")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Link href={`/sale-orders/${it.saleOrder.id}`} className="text-blue-600 hover:underline">
                      {it.saleOrder.orderNo}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-900">{it.saleOrder.customer.name}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{it.product.code}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-900">{it.product.name}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{it.unit.name}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{Number(it.quantity).toFixed(3)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">¥{Number(it.unitPrice).toFixed(2)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">¥{Number(it.amount).toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-gray-500">{it.remark || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {itemPages > 1 && (
            <div className="flex items-center gap-3 border-t border-gray-100 px-4 py-3 text-sm">
              {page > 1 ? (
                <Link href={buildHref(page - 1)} className="text-blue-600 hover:underline">上一页</Link>
              ) : (
                <span className="text-gray-400">上一页</span>
              )}
              <span className="text-gray-600">第 {page} / {itemPages} 页</span>
              {page < itemPages ? (
                <Link href={buildHref(page + 1)} className="text-blue-600 hover:underline">下一页</Link>
              ) : (
                <span className="text-gray-400">下一页</span>
              )}
            </div>
          )}
        </div>
      ) : (
      <SaleOrderTable rows={saleOrderRows}>
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
      </SaleOrderTable>
      )}
    </div>
  );

  function buildHref(p: number): string {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (customerId) sp.set("customerId", String(customerId));
    if (status) sp.set("status", status);
    if (settle) sp.set("settle", settle);
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
    if (mode === "item") sp.set("mode", "item");
    sp.set("page", String(p));
    return `/sale-orders?${sp.toString()}`;
  }

  /** 查看方式切换：保留当前所有筛选（函数声明，供 JSX 提前使用） */
  function modeHref(m: "order" | "item"): string {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (customerId != null) sp.set("customerId", String(customerId));
    if (status) sp.set("status", status);
    if (settle) sp.set("settle", settle);
    if (starredOnly) sp.set("star", "1");
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
    if (m === "item") sp.set("mode", "item");
    const qs = sp.toString();
    return qs ? `/sale-orders?${qs}` : "/sale-orders";
  };
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
