import { prisma } from "@/lib/prisma";

/**
 * 报表中心数据层（文档 3.8）：页面展示与 Excel 导出共用同一套查询与列定义。
 * 口径：同期内「非作废」单据；采购额按已入库进货单（receivedAt）；销售额与毛利按
 * 售卖单成本快照（毛利 = 销售额 − Σ成本快照），与单据详情页口径一致。
 */

export interface ReportColumn {
  key: string;
  label: string;
  align?: "right";
}

export interface ReportRow {
  [key: string]: string | number | null;
}

export interface ReportResult {
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
}

/** from/to 为 yyyy-mm-dd；默认本月 1 日至今天。 */
export function dateRange(from?: string, to?: string): { gte: Date; lte: Date } {
  const now = new Date();
  const fr = from && /^\d{4}-\d{2}-\d{2}$/.test(from)
    ? new Date(`${from}T00:00:00`)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const toDate = to && /^\d{4}-\d{2}-\d{2}$/.test(to)
    ? new Date(`${to}T00:00:00`)
    : now;
  const lte = new Date(toDate.getTime());
  lte.setHours(23, 59, 59, 999);
  return { gte: new Date(fr.getTime()), lte };
}

export async function inventoryReport(): Promise<ReportResult> {
  const [products, activePos] = await Promise.all([
    prisma.product.findMany({
      orderBy: { code: "asc" },
      include: { unit: { select: { name: true } }, category: { select: { name: true } } },
    }),
    prisma.purchaseOrder.findMany({
      where: { status: { not: "voided" } },
      select: { orderNo: true },
    }),
  ]);
  const purchaseIns = await prisma.stockMovement.findMany({
    where: { bizType: "purchase_in", bizOrderNo: { in: activePos.map((o) => o.orderNo) } },
    orderBy: { createdAt: "desc" },
    select: { productId: true, unitCost: true },
  });
  const lastPrice = new Map<number, number>();
  for (const m of purchaseIns) {
    if (!lastPrice.has(m.productId)) lastPrice.set(m.productId, Number(m.unitCost));
  }

  return {
    title: "库存查询",
    columns: [
      { key: "code", label: "编码" },
      { key: "name", label: "名称" },
      { key: "category", label: "分类" },
      { key: "unit", label: "单位" },
      { key: "qty", label: "库存数量", align: "right" },
      { key: "amount", label: "成本金额", align: "right" },
      { key: "avg", label: "均价", align: "right" },
      { key: "lastPrice", label: "最近进价", align: "right" },
      { key: "minStock", label: "预警线", align: "right" },
      { key: "status", label: "状态" },
    ],
    rows: products.map((p) => ({
      code: p.code,
      name: p.name,
      category: p.category?.name ?? "",
      unit: p.unit.name,
      qty: Number(p.stockQty),
      amount: Number(p.stockAmount),
      avg: Number(p.avgCost),
      lastPrice: lastPrice.get(p.id) ?? null,
      minStock: Number(p.minStock),
      status: p.status === 1 ? "启用" : "停用",
    })),
  };
}

export async function summaryReport(from?: string, to?: string): Promise<ReportResult> {
  const { gte, lte } = dateRange(from, to);
  const [purchases, sales, saleItems] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { status: "received", receivedAt: { gte, lte } },
      select: { totalAmount: true },
    }),
    prisma.saleOrder.findMany({
      where: { status: "confirmed", createdAt: { gte, lte } },
      select: { id: true, totalAmount: true },
    }),
    prisma.saleOrderItem.findMany({
      where: { saleOrder: { status: "confirmed", createdAt: { gte, lte } } },
      select: { costAmount: true },
    }),
  ]);
  const purchaseAmount = purchases.reduce((s, o) => s + Number(o.totalAmount), 0);
  const saleAmount = sales.reduce((s, o) => s + Number(o.totalAmount), 0);
  const costAmount = saleItems.reduce((s, i) => s + Number(i.costAmount), 0);

  return {
    title: "进销存汇总",
    columns: [
      { key: "metric", label: "指标" },
      { key: "value", label: "金额（元）", align: "right" },
    ],
    rows: [
      { metric: `采购额（已入库进货单，期间 ${fmt(gte)} ~ ${fmt(lte)}）`, value: purchaseAmount },
      { metric: "销售额（非作废售卖单）", value: saleAmount },
      { metric: "成本（销售成本快照）", value: costAmount },
      { metric: "毛利润（销售额 − 成本快照）", value: saleAmount - costAmount },
    ],
  };
}

export async function payablesReport(from?: string, to?: string): Promise<ReportResult> {
  const { gte, lte } = dateRange(from, to);
  const orders = await prisma.purchaseOrder.findMany({
    where: { status: { not: "voided" }, createdAt: { gte, lte } },
    include: {
      supplier: { select: { name: true } },
      returns: { where: { status: "confirmed" } },
    },
    orderBy: { createdAt: "desc" },
  });
  return {
    title: "应付明细",
    columns: [
      { key: "supplier", label: "供应商" },
      { key: "orderNo", label: "单据号" },
      { key: "status", label: "状态" },
      { key: "total", label: "应付", align: "right" },
      { key: "paid", label: "已付", align: "right" },
      { key: "returned", label: "退货冲减", align: "right" },
      { key: "unpaid", label: "未付", align: "right" },
    ],
    rows: orders.map((o) => {
      const returned = o.returns.reduce((s, r) => s + Number(r.totalAmount), 0);
      return {
        supplier: o.supplier.name,
        orderNo: o.orderNo,
        status: o.status === "received" ? "已入库" : o.status === "pending" ? "待收货" : "作废",
        total: Number(o.totalAmount),
        paid: Number(o.paidAmount),
        returned,
        unpaid: Math.max(0, Number(o.totalAmount) - Number(o.paidAmount) - returned),
      };
    }),
  };
}

export async function receivablesReport(from?: string, to?: string): Promise<ReportResult> {
  const { gte, lte } = dateRange(from, to);
  const orders = await prisma.saleOrder.findMany({
    where: { status: { not: "voided" }, createdAt: { gte, lte } },
    include: {
      customer: { select: { name: true } },
      returns: { where: { status: "confirmed" } },
    },
    orderBy: { createdAt: "desc" },
  });
  return {
    title: "应收明细",
    columns: [
      { key: "customer", label: "客户" },
      { key: "orderNo", label: "单据号" },
      { key: "status", label: "状态" },
      { key: "total", label: "应收", align: "right" },
      { key: "received", label: "已收", align: "right" },
      { key: "returned", label: "退货冲减", align: "right" },
      { key: "unreceived", label: "未收", align: "right" },
    ],
    rows: orders.map((o) => {
      const returned = o.returns.reduce((s, r) => s + Number(r.totalAmount), 0);
      return {
        customer: o.customer.name,
        orderNo: o.orderNo,
        status: o.status === "confirmed" ? "已开单" : "作废",
        total: Number(o.totalAmount),
        received: Number(o.receivedAmount),
        returned,
        unreceived: Math.max(0, Number(o.totalAmount) - Number(o.receivedAmount) - returned),
      };
    }),
  };
}

export async function salesRankReport(from?: string, to?: string): Promise<ReportResult> {
  const { gte, lte } = dateRange(from, to);
  const items = await prisma.saleOrderItem.findMany({
    where: { saleOrder: { status: "confirmed", createdAt: { gte, lte } } },
    include: { product: { select: { code: true, name: true, unit: { select: { name: true } } } } },
  });
  const agg = new Map<number, { code: string; name: string; unit: string; qty: number; amount: number; cost: number }>();
  for (const it of items) {
    const cur = agg.get(it.productId) ?? {
      code: it.product.code,
      name: it.product.name,
      unit: it.product.unit.name,
      qty: 0,
      amount: 0,
      cost: 0,
    };
    cur.qty += Number(it.quantity);
    cur.amount += Number(it.amount);
    cur.cost += Number(it.costAmount);
    agg.set(it.productId, cur);
  }
  const rows = [...agg.values()].sort((a, b) => b.amount - a.amount);
  return {
    title: "单品销售排行",
    columns: [
      { key: "code", label: "编码" },
      { key: "name", label: "名称" },
      { key: "unit", label: "单位" },
      { key: "qty", label: "销量", align: "right" },
      { key: "amount", label: "销售额", align: "right" },
      { key: "cost", label: "成本", align: "right" },
      { key: "profit", label: "毛利", align: "right" },
    ],
    rows: rows.map((r) => ({ ...r, profit: r.amount - r.cost })),
  };
}

export async function operatorPerfReport(from?: string, to?: string): Promise<ReportResult> {
  const { gte, lte } = dateRange(from, to);
  const orders = await prisma.saleOrder.findMany({
    where: { status: "confirmed", createdAt: { gte, lte } },
    include: {
      operator: { select: { displayName: true, role: true } },
      items: { select: { amount: true, costAmount: true } },
    },
  });
  const agg = new Map<number, { name: string; role: string; count: number; amount: number; cost: number }>();
  for (const o of orders) {
    const cur = agg.get(o.operatorId) ?? {
      name: o.operator.displayName,
      role: o.operator.role,
      count: 0,
      amount: 0,
      cost: 0,
    };
    cur.count += 1;
    cur.amount += Number(o.totalAmount);
    cur.cost += o.items.reduce((s, it) => s + Number(it.costAmount), 0);
    agg.set(o.operatorId, cur);
  }
  const rows = [...agg.values()].sort((a, b) => b.amount - a.amount);
  return {
    title: "操作员业绩",
    columns: [
      { key: "name", label: "操作员" },
      { key: "role", label: "角色" },
      { key: "count", label: "开单数", align: "right" },
      { key: "amount", label: "销售额", align: "right" },
      { key: "cost", label: "成本", align: "right" },
      { key: "profit", label: "毛利", align: "right" },
    ],
    rows: rows.map((r) => ({ ...r, profit: r.amount - r.cost })),
  };
}

function fmt(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export const REPORT_TABS = [
  { key: "inventory", label: "库存查询" },
  { key: "summary", label: "进销存汇总" },
  { key: "payables", label: "应付明细" },
  { key: "receivables", label: "应收明细" },
  { key: "sales-rank", label: "单品销售排行" },
  { key: "operator-perf", label: "操作员业绩" },
] as const;

export type ReportTabKey = (typeof REPORT_TABS)[number]["key"];

export async function buildReport(
  tab: ReportTabKey,
  from?: string,
  to?: string
): Promise<ReportResult> {
  switch (tab) {
    case "inventory":
      return inventoryReport();
    case "summary":
      return summaryReport(from, to);
    case "payables":
      return payablesReport(from, to);
    case "receivables":
      return receivablesReport(from, to);
    case "sales-rank":
      return salesRankReport(from, to);
    case "operator-perf":
      return operatorPerfReport(from, to);
  }
}
