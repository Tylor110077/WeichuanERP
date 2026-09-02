import { prisma } from "@/lib/prisma";

/**
 * 客户画像数据层：客户汇总（单数/销售额/成本/毛利/平均利润率）与明细单据。
 * 客户管理页（面板）与客户画像页共用；口径：非作废售卖单，成本按单据成本快照。
 */

export interface CustomerProfileRow {
  id: number;
  name: string;
  groupName: string;
  tagNames: string[];
  count: number;
  sales: number;
  cost: number;
  profit: number;
  margin: number;
}

export async function buildCustomerProfile(from?: string, to?: string) {
  const { gte, lte } = dateRange(from, to);

  const [rawCustomers, orders] = await Promise.all([
    prisma.customer.findMany({
      orderBy: { name: "asc" },
      include: {
        group: { select: { name: true } },
        tagLinks: { include: { tag: { select: { name: true } } } },
      },
    }),
    prisma.saleOrder.findMany({
      where: { status: "confirmed", createdAt: { gte, lte } },
      include: {
        items: { include: { product: { select: { code: true, name: true } }, unit: { select: { name: true } } } },
      },
      orderBy: { createdAt: "asc" },
      take: 5000,
    }),
  ]);

  const customers = rawCustomers.map((c) => ({
    id: c.id,
    name: c.name,
    groupName: c.group?.name ?? "",
    tagNames: c.tagLinks.map((l) => l.tag.name),
  }));

  const agg = new Map<number, { count: number; sales: number; cost: number }>();
  for (const o of orders) {
    const cur = agg.get(o.customerId) ?? { count: 0, sales: 0, cost: 0 };
    cur.count += 1;
    cur.sales += Number(o.totalAmount);
    cur.cost += o.items.reduce((s, it) => s + Number(it.costAmount), 0);
    agg.set(o.customerId, cur);
  }

  const profileRows = [...agg.entries()]
    .map(([id, a]) => {
      const c = customers.find((x) => x.id === id)!;
      const profit = a.sales - a.cost;
      return {
        id,
        name: c.name,
        groupName: c.groupName,
        tagNames: c.tagNames,
        count: a.count,
        sales: a.sales,
        cost: a.cost,
        profit,
        margin: a.sales > 0 ? (profit / a.sales) * 100 : 0,
      };
    })
    .sort((a, b) => b.profit - a.profit);

  return { customers, orders, profileRows };
}

function dateRange(from?: string, to?: string): { gte: Date; lte: Date } {
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { gte: new Date(`${from}T00:00:00`), lte: new Date(`${to}T23:59:59.999`) };
  }
  return { gte: new Date(2000, 0, 1), lte: new Date(2100, 11, 31, 23, 59, 59, 999) };
}
