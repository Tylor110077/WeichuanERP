import { prisma } from "@/lib/prisma";

/**
 * 商品价格分析：同一商品对不同客户、不同时间的售价与成本（开单成本快照）变化。
 * 口径：非作废售卖单；单位成本 = 单行 costAmount / 数量（与销售分析、报表中心一致）。
 * 图形口径：每天一个成本点（当日数量加权平均成本）；当日多笔成本不同时，
 * 以当日最高/最低成本连线成波动区间；实际售价全部为灰点，不按客户配色。
 */

export interface PricePoint {
  ts: number; // 开单时间（epoch ms）
  dayTs: number; // 开单日零点（epoch ms，图上 X 轴按天定位）
  date: string; // yyyy/M/d
  customer: string;
  orderNo: string;
  qty: number;
  unitPrice: number; // 售价
  unitCost: number; // 成本单价（快照）
  amount: number;
  costAmount: number;
  profit: number;
  margin: number; // 毛利率 %
}

export interface DayStats {
  dayTs: number; // 当日零点（图上 X 轴）
  date: string; // yyyy/M/d
  saleCount: number;
  qty: number;
  amount: number;
  cost: number;
  minCost: number; // 当日最低成本单价
  maxCost: number; // 当日最高成本单价
  avgCost: number; // 当日加权平均成本单价（数量加权）
  highest: PricePoint; // 当日售价最高的单
  lowest: PricePoint; // 当日售价最低的单
}

export interface CustomerPriceRow {
  customer: string;
  orderCount: number;
  qty: number;
  amount: number;
  cost: number;
  profit: number;
  avgPrice: number; // 加权平均售价 = 金额 / 数量
  avgCost: number; // 加权平均成本单价
  minPrice: number;
  maxPrice: number;
  margin: number; // 毛利率 %
  lastDate: string;
}

export interface PriceAnalysis {
  product: { code: string; name: string; unit: string; refSalePrice: number };
  points: PricePoint[];
  byDay: DayStats[];
  byCustomer: CustomerPriceRow[];
  totals: {
    qty: number;
    amount: number;
    cost: number;
    profit: number;
    avgPrice: number;
    avgCost: number;
    margin: number;
    minPrice: number;
    maxPrice: number;
  };
}

export async function buildPriceAnalysis(
  productId: number,
  gte: Date,
  lte: Date
): Promise<PriceAnalysis | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      code: true,
      name: true,
      refSalePrice: true,
      unit: { select: { name: true } },
    },
  });
  if (!product) return null;

  const items = await prisma.saleOrderItem.findMany({
    where: {
      productId,
      saleOrder: { status: "confirmed", createdAt: { gte, lte } },
    },
    include: {
      saleOrder: {
        select: {
          orderNo: true,
          createdAt: true,
          customer: { select: { name: true } },
        },
      },
    },
    orderBy: { saleOrder: { createdAt: "asc" } },
    take: 3000,
  });

  const points: PricePoint[] = items.map((it) => {
    const qty = Number(it.quantity);
    const amount = Number(it.amount);
    const costAmount = Number(it.costAmount);
    const unitPrice = qty > 0 ? Number(it.unitPrice) : 0;
    const unitCost = qty > 0 ? costAmount / qty : 0;
    const created = it.saleOrder.createdAt;
    return {
      ts: created.getTime(),
      dayTs: new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime(),
      date: created.toLocaleDateString("zh-CN"),
      customer: it.saleOrder.customer.name,
      orderNo: it.saleOrder.orderNo,
      qty,
      unitPrice,
      unitCost,
      amount,
      costAmount,
      profit: amount - costAmount,
      margin: amount > 0 ? ((amount - costAmount) / amount) * 100 : 0,
    };
  });

  // 按天汇总：成本最高/最低（波动区间）、加权平均成本、当日售价最高/最低的单
  const dayMap = new Map<
    number,
    {
      date: string;
      saleCount: number;
      qty: number;
      amount: number;
      cost: number;
      minCost: number;
      maxCost: number;
      highest: PricePoint;
      lowest: PricePoint;
    }
  >();
  for (const p of points) {
    const cur = dayMap.get(p.dayTs);
    if (!cur) {
      dayMap.set(p.dayTs, {
        date: p.date,
        saleCount: 1,
        qty: p.qty,
        amount: p.amount,
        cost: p.costAmount,
        minCost: p.unitCost,
        maxCost: p.unitCost,
        highest: p,
        lowest: p,
      });
      continue;
    }
    cur.saleCount += 1;
    cur.qty += p.qty;
    cur.amount += p.amount;
    cur.cost += p.costAmount;
    cur.minCost = Math.min(cur.minCost, p.unitCost);
    cur.maxCost = Math.max(cur.maxCost, p.unitCost);
    if (p.unitPrice > cur.highest.unitPrice) cur.highest = p;
    if (p.unitPrice < cur.lowest.unitPrice) cur.lowest = p;
  }
  const byDay: DayStats[] = [...dayMap.entries()]
    .map(([dayTs, v]) => ({
      dayTs,
      date: v.date,
      saleCount: v.saleCount,
      qty: v.qty,
      amount: v.amount,
      cost: v.cost,
      minCost: v.minCost,
      maxCost: v.maxCost,
      avgCost: v.qty > 0 ? v.cost / v.qty : 0,
      highest: v.highest,
      lowest: v.lowest,
    }))
    .sort((a, b) => a.dayTs - b.dayTs);

  // 按客户汇总（加权均价、最低/最高售价、毛利率）
  const map = new Map<
    string,
    {
      orderNos: Set<string>;
      qty: number;
      amount: number;
      cost: number;
      minPrice: number;
      maxPrice: number;
      lastDate: string;
    }
  >();
  for (const p of points) {
    const cur = map.get(p.customer) ?? {
      orderNos: new Set<string>(),
      qty: 0,
      amount: 0,
      cost: 0,
      minPrice: Infinity,
      maxPrice: -Infinity,
      lastDate: "",
    };
    cur.orderNos.add(p.orderNo);
    cur.qty += p.qty;
    cur.amount += p.amount;
    cur.cost += p.costAmount;
    if (p.unitPrice > 0) {
      cur.minPrice = Math.min(cur.minPrice, p.unitPrice);
      cur.maxPrice = Math.max(cur.maxPrice, p.unitPrice);
    }
    if (p.date > cur.lastDate) cur.lastDate = p.date;
    map.set(p.customer, cur);
  }
  const byCustomer: CustomerPriceRow[] = [...map.entries()]
    .map(([customer, v]) => {
      const profit = v.amount - v.cost;
      return {
        customer,
        orderCount: v.orderNos.size,
        qty: v.qty,
        amount: v.amount,
        cost: v.cost,
        profit,
        avgPrice: v.qty > 0 ? v.amount / v.qty : 0,
        avgCost: v.qty > 0 ? v.cost / v.qty : 0,
        minPrice: v.minPrice === Infinity ? 0 : v.minPrice,
        maxPrice: v.maxPrice === -Infinity ? 0 : v.maxPrice,
        margin: v.amount > 0 ? (profit / v.amount) * 100 : 0,
        lastDate: v.lastDate,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const qty = points.reduce((s, p) => s + p.qty, 0);
  const amount = points.reduce((s, p) => s + p.amount, 0);
  const cost = points.reduce((s, p) => s + p.costAmount, 0);
  const prices = points.map((p) => p.unitPrice).filter((v) => v > 0);
  const totals = {
    qty,
    amount,
    cost,
    profit: amount - cost,
    avgPrice: qty > 0 ? amount / qty : 0,
    avgCost: qty > 0 ? cost / qty : 0,
    margin: amount > 0 ? ((amount - cost) / amount) * 100 : 0,
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
  };

  return {
    product: {
      code: product.code,
      name: product.name,
      unit: product.unit.name,
      refSalePrice: Number(product.refSalePrice),
    },
    points,
    byDay,
    byCustomer,
    totals,
  };
}
