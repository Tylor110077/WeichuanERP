import { redirect } from "next/navigation";
import Link from "next/link";
import { FilterForm } from "@/components/filter-form";
import { SearchInput } from "@/components/search-input";
import { btnPrimary, btnSecondary, inputBase } from "@/lib/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { DraftResumeLink } from "@/components/draft-resume-link";
import { prisma } from "@/lib/prisma";
import { pinyinQuery } from "@/lib/pinyin";
import { initials } from "@/lib/pinyin";
import { DateShortcuts } from "@/components/date-shortcuts";
import { SearchSelect } from "@/components/search-select";
import { PurchaseOrderTable, type PurchaseOrderRow } from "./order-table";

export const metadata = { title: "进货单 - 玮川进销存" };

const PAGE_SIZE = 20;

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; from?: string; to?: string; supplierId?: string; q?: string; settle?: string; star?: string }>;
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
            product: { select: { code: true, name: true } },
            unit: { select: { name: true } },
          },
        },
      },
    }),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
    sp.set("page", String(p));
    return `/purchase-orders?${sp.toString()}`;
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
