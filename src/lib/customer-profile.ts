import { prisma } from "@/lib/prisma";

/**
 * 客户画像数据层：客户汇总（单数/销售额/成本/毛利/平均利润率）与明细单据。
 * 客户管理页（面板）与客户画像页共用；口径：非作废售卖单，成本按单据成本快照。
 *
 * 性能：汇总全部在 SQL 里分组算（原来是把时间段内所有单子连同全部商品行拉进
 * 内存再循环求和——客户与单据一多，这一页会明显变慢）。单据明细也只取当前页。
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

/** 售卖单筛选条件：时间段 + 可选的"单里有这个品名/编码" */
function orderFilter(from?: string, to?: string, productKeyword?: string) {
  const { gte, lte } = dateRange(from, to);
  const kw = productKeyword?.trim();
  return {
    status: "confirmed" as const,
    createdAt: { gte, lte },
    // 按品名/编码搜单：单里只要有一行是这个商品就算命中；
    // 命中之后统计也跟着这份筛选走，否则上面的数字和下面的单子会对不上
    ...(kw
      ? {
          items: {
            some: {
              product: { OR: [{ name: { contains: kw } }, { code: { contains: kw } }] },
            },
          },
        }
      : {}),
  };
}

export async function buildCustomerProfile(from?: string, to?: string, productKeyword?: string) {
  const where = orderFilter(from, to, productKeyword);

  const [rawCustomers, salesByCustomer, costByOrder, orderOwners] = await Promise.all([
    prisma.customer.findMany({
      orderBy: { name: "asc" },
      include: {
        group: { select: { name: true } },
        tagLinks: { include: { tag: { select: { name: true } } } },
      },
    }),
    // 单数与销售额：交给 SQL 按客户分组
    prisma.saleOrder.groupBy({
      by: ["customerId"],
      where,
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    // 成本：按单分组的快照之和。只取「单 id + 成本和」两列，
    // 不再把每张单的商品明细整份拉回来（那是原实现里最重的一步）
    prisma.saleOrderItem.groupBy({
      by: ["saleOrderId"],
      where: { saleOrder: where },
      _sum: { costAmount: true },
    }),
    // 单据 → 客户 的轻量索引，用来把上面的成本归到客户头上
    prisma.saleOrder.findMany({ where, select: { id: true, customerId: true } }),
  ]);

  const customers = rawCustomers.map((c) => ({
    id: c.id,
    name: c.name,
    groupName: c.group?.name ?? "",
    tagNames: c.tagLinks.map((l) => l.tag.name),
  }));
  const ownerOf = new Map(orderOwners.map((o) => [o.id, o.customerId]));

  const agg = new Map<number, { count: number; sales: number; cost: number }>();
  for (const g of salesByCustomer) {
    agg.set(g.customerId, {
      count: g._count._all,
      sales: Number(g._sum.totalAmount ?? 0),
      cost: 0,
    });
  }
  for (const c of costByOrder) {
    const cid = ownerOf.get(c.saleOrderId);
    if (cid == null) continue;
    const cur = agg.get(cid) ?? { count: 0, sales: 0, cost: 0 };
    cur.cost += Number(c._sum.costAmount ?? 0);
    agg.set(cid, cur);
  }

  const profileRows = [...agg.entries()]
    .map(([id, a]) => {
      const c = customers.find((x) => x.id === id);
      const profit = a.sales - a.cost;
      return {
        id,
        name: c?.name ?? `客户 #${id}`,
        groupName: c?.groupName ?? "",
        tagNames: c?.tagNames ?? [],
        count: a.count,
        sales: a.sales,
        cost: a.cost,
        profit,
        margin: a.sales > 0 ? (profit / a.sales) * 100 : 0,
      };
    })
    .sort((a, b) => b.profit - a.profit);

  return { customers, profileRows };
}

/**
 * 某个客户的单据明细（带商品行），只取第 page 页。
 * 页码在函数内按总数夹紧：地址栏里乱填 opage 也不会翻出空白页。
 */
export async function getCustomerOrderPage(
  customerId: number,
  from: string | undefined,
  to: string | undefined,
  productKeyword: string | undefined,
  page: number,
  pageSize: number
) {
  const where = { ...orderFilter(from, to, productKeyword), customerId };
  const total = await prisma.saleOrder.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const rows = await prisma.saleOrder.findMany({
    where,
    include: {
      items: { include: { product: { select: { code: true, name: true } }, unit: { select: { name: true } } } },
    },
    // 同一秒创建的两张单也要有稳定顺序，否则翻页会出现重复/漏项
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (current - 1) * pageSize,
    take: pageSize,
  });
  return { rows, total, page: current, totalPages };
}

/**
 * 时间范围：只填一头也算（只填开始＝从那天到现在，只填结束＝从最早到那天）。
 * 以前必须两头都填才生效，但界面上写的是「最早 ~ 今天」，两边对不上。
 */
function dateRange(from?: string, to?: string): { gte: Date; lte: Date } {
  const valid = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  return {
    gte: valid(from) ? new Date(`${from}T00:00:00`) : new Date(2000, 0, 1),
    lte: valid(to) ? new Date(`${to}T23:59:59.999`) : new Date(2100, 11, 31, 23, 59, 59, 999),
  };
}
