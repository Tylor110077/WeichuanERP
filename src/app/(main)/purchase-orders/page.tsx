import { redirect } from "next/navigation";
import Link from "next/link";
import { FilterForm } from "@/components/filter-form";
import { SearchInput } from "@/components/search-input";
import { btnPrimary, btnSecondary, inputBase, segActive, segIdle } from "@/lib/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { DraftResumeLink } from "@/components/draft-resume-link";
import { prisma } from "@/lib/prisma";
import { pinyinQuery } from "@/lib/pinyin";
import { initials } from "@/lib/pinyin-server";
import { DateShortcuts } from "@/components/date-shortcuts";
import { SearchSelect } from "@/components/search-select";
import { PurchaseOrderTable, type PurchaseOrderRow } from "./order-table";

export const metadata = { title: "进货单 - 玮川进销存" };

const PAGE_SIZE = 20;

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; from?: string; to?: string; supplierId?: string; q?: string; settle?: string; star?: string; mode?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = params.status || undefined;
  const supplierId = params.supplierId ? Number(params.supplierId) : undefined;
  const q = params.q?.trim();
  const settle =
    params.settle === "settled" || params.settle === "unsettled" ? params.settle : undefined;
  const range = dateRange(params.from, params.to);
  /** 只看星标：星标是"重要/待跟进"的标记，列表要能一键筛出来 */
  const starredOnly = params.star === "1";
  /** 查看方式：按单据（可展开商品）/ 只看商品（把商品行平铺，不分单） */
  const mode = params.mode === "item" ? "item" : "order";

  // 付款结清筛选：未结清 = 应付 − 已付 − 未作废退货冲减 > 0（不含已作废单）
  let settleIds: number[] | null = null;
  if (settle === "settled") {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT po.id FROM purchase_orders po
      LEFT JOIN (
        SELECT purchase_order_id, SUM(total_amount) AS t
        FROM purchase_returns WHERE status = 'confirmed' GROUP BY purchase_order_id
      ) pr ON pr.purchase_order_id = po.id
      WHERE po.status IN ('pending', 'received')
        AND (po.total_amount - po.paid_amount - COALESCE(pr.t, 0)) <= 0`;
    settleIds = rows.map((r) => r.id);
  } else if (settle === "unsettled") {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT po.id FROM purchase_orders po
      LEFT JOIN (
        SELECT purchase_order_id, SUM(total_amount) AS t
        FROM purchase_returns WHERE status = 'confirmed' GROUP BY purchase_order_id
      ) pr ON pr.purchase_order_id = po.id
      WHERE po.status IN ('pending', 'received')
        AND (po.total_amount - po.paid_amount - COALESCE(pr.t, 0)) > 0`;
    settleIds = rows.map((r) => r.id);
  }

  const where = {
    ...(status ? { status: status as "pending" | "received" | "voided" } : {}),
    ...(supplierId ? { supplierId } : {}),
    // 单据号 + 厂家名（中文或拼音首字母，如 yddl 找到远东电缆的单）
    ...(q
      ? {
          OR: [
            { orderNo: { contains: q } },
            { supplier: { name: { contains: q } } },
            { supplier: { searchPinyin: { contains: pinyinQuery(q) } } },
          ],
        }
      : {}),
    ...(settleIds ? { id: { in: settleIds } } : {}),
    ...(starredOnly ? { starred: true } : {}),
    createdAt: { gte: range.gte, lte: range.lte },
    // 矩阵：业务员只能看自己开的单
    ...(user.role === "sales" ? { operatorId: user.id } : {}),
  };

  const [total, orders, suppliers] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        supplier: { select: { name: true } },
        operator: { select: { displayName: true, role: true } },
        returns: { where: { status: "confirmed" }, select: { totalAmount: true } },
        // 行内展开要看商品，所以把商品行一起带出来
        items: {
          include: {
            product: { select: { code: true, name: true, manufacturer: true } },
            unit: { select: { name: true } },
          },
        },
      },
    }),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 只看商品：把筛选出的单据里的商品行平铺出来（不分单），同样分页
  const itemWhere = { purchaseOrder: where };
  const [itemTotal, itemRows, itemSum] =
    mode === "item"
      ? await Promise.all([
          prisma.purchaseOrderItem.count({ where: itemWhere }),
          prisma.purchaseOrderItem.findMany({
            where: itemWhere,
            orderBy: { purchaseOrder: { createdAt: "desc" } },
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
            include: {
              purchaseOrder: {
                select: { id: true, orderNo: true, createdAt: true, supplier: { select: { name: true } } },
              },
              product: { select: { code: true, name: true, manufacturer: true } },
              unit: { select: { name: true } },
            },
          }),
          prisma.purchaseOrderItem.aggregate({ where: itemWhere, _sum: { quantity: true, amount: true } }),
        ])
      : [0, [], null];
  const itemPages = Math.max(1, Math.ceil(itemTotal / PAGE_SIZE));

  /** 传给列表组件的数据：都算好成纯值，组件只管展示与展开 */
  const purchaseOrderRows: PurchaseOrderRow[] = orders.map((o) => {
    const returned = o.returns.reduce((sum, r) => sum + Number(r.totalAmount), 0);
    const outstanding = Number(o.totalAmount) - Number(o.paidAmount) - returned;
    return {
      id: o.id,
      orderNo: o.orderNo,
      supplierName: o.supplier.name,
      status: o.status,
      totalAmount: Number(o.totalAmount),
      paidAmount: Number(o.paidAmount),
      returned,
      sourceType: o.sourceType,
      operatorName: o.operator.displayName,
      operatorRole: o.operator.role,
      createdAtLabel: o.createdAt.toLocaleString("zh-CN"),
      starred: o.starred,
      needsPayment: o.status !== "voided" && outstanding > 0,
      items: o.items.map((it) => ({
        id: it.id,
        code: it.product.code,
        name: it.product.name,
        manufacturer: it.product.manufacturer ?? "",
        unit: it.unit.name,
        qty: Number(it.quantity),
        price: Number(it.unitPrice),
        amount: Number(it.amount),
        remark: it.remark ?? "",
      })),
    };
  });
  const statusOptions = [
    { value: "", label: "全部状态" },
    { value: "pending", label: "待收货" },
    { value: "received", label: "已入库" },
    { value: "voided", label: "已作废" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">进货单</h1>
        {user.role !== "boss" && (
          <div className="flex flex-wrap items-center gap-2">
            <DraftResumeLink scope="purchase" userId={user.id} href="/purchase-orders/new" label="继续未完成的进货单" />
            <Link
              href="/purchase-orders/new"
              className={btnPrimary}
            >
              新建进货单
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
        basePath="/purchase-orders"
        extraQuery={{
          supplierId: supplierId != null ? String(supplierId) : "",
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
          placeholder="单据号 / 厂家名"
          defaultValue={q}
          className={`${inputBase} w-40`}
        />
        <SearchSelect
          name="supplierId"
          options={suppliers.map((s) => ({ value: String(s.id), label: s.name, py: initials(s.name) }))}
          defaultValue={supplierId != null ? String(supplierId) : ""}
          noneLabel="全部厂家"
          placeholder="厂家（可搜索）"
          className="w-52"
        />
        <input type="date" name="from" defaultValue={params.from} className={`${inputBase}`} />
        <input type="date" name="to" defaultValue={params.to} className={`${inputBase}`} />
        <select name="status" defaultValue={status ?? ""} className={`${inputBase}`}>
          {statusOptions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
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
        <button
          type="submit"
          className={btnSecondary}
        >
          筛选
        </button>
        <span className="text-xs text-gray-500">共 {total} 张</span>
      </FilterForm>

      {mode === "item" ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[76rem] divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-medium">日期</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">来源单据</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">厂家</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">编码</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">品名</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">厂家</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">单位</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">数量</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">进价</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">金额</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">备注</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
              {itemRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-sm text-gray-400">
                    该条件下没有商品行
                  </td>
                </tr>
              )}
              {itemRows.map((it) => (
                <tr key={it.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600 tabular-nums">
                    {it.purchaseOrder.createdAt.toLocaleDateString("zh-CN")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Link href={`/purchase-orders/${it.purchaseOrder.id}`} className="text-blue-600 hover:underline">
                      {it.purchaseOrder.orderNo}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-900">{it.purchaseOrder.supplier.name}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{it.product.code}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-900">{it.product.name}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{it.product.manufacturer || "—"}</td>
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
      <PurchaseOrderTable rows={purchaseOrderRows}>
        {totalPages > 1 && (
          <div className="flex items-center gap-3 border-t border-gray-100 px-4 py-3 text-sm">
            {page > 1 ? (
              <Link href={buildHref(page - 1)} className="text-blue-600 hover:underline">
                上一页
              </Link>
            ) : (
              <span className="text-gray-400">上一页</span>
            )}
            <span className="text-gray-600">
              第 {page} / {totalPages} 页
            </span>
            {page < totalPages ? (
              <Link href={buildHref(page + 1)} className="text-blue-600 hover:underline">
                下一页
              </Link>
            ) : (
              <span className="text-gray-400">下一页</span>
            )}
          </div>
        )}
      </PurchaseOrderTable>
      )}
    </div>
  );

  function buildHref(p: number): string {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (supplierId) sp.set("supplierId", String(supplierId));
    if (status) sp.set("status", status);
    if (settle) sp.set("settle", settle);
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
    if (starredOnly) sp.set("star", "1");
    if (mode === "item") sp.set("mode", "item");
    sp.set("page", String(p));
    return `/purchase-orders?${sp.toString()}`;
  }

  /** 查看方式切换：保留当前所有筛选（函数声明，供 JSX 提前使用） */
  function modeHref(m: "order" | "item"): string {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (supplierId) sp.set("supplierId", String(supplierId));
    if (status) sp.set("status", status);
    if (settle) sp.set("settle", settle);
    if (starredOnly) sp.set("star", "1");
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
    if (m === "item") sp.set("mode", "item");
    const qs = sp.toString();
    return qs ? `/purchase-orders?${qs}` : "/purchase-orders";
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
