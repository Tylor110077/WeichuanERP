import { prisma } from "@/lib/prisma";

/**
 * 商品价格分析：同一商品对不同客户、不同时间的售价与成本（开单成本快照）变化。
 * 口径：非作废售卖单；单位成本 = 单行 costAmount / 数量（与销售分析、报表中心一致）。
 */

export interface PricePoint {
  ts: number; // 开单时间（epoch ms，图上 X 轴）
  date: string; // yyyy/M/d（表格与提示用）
  customer: string;
  orderNo: string;
  qty: number;
  unitPrice: number; // 售价
  unitCost: number; // 成本单价（快照）
  amount: number;
  costAmount: number;
  profit: number;
}

/** 图上用的点位：带客户配色 */
export interface ColoredPricePoint extends PricePoint {
  color: string;
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
  points: ColoredPricePoint[];
  byCustomer: CustomerPriceRow[];
  /** 图例配色：出现过的客户（按销售额降序前 9 个）+「其他客户」 */
  customerColors: { customer: string; color: string }[];
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

const PALETTE = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#be185d",
  "#65a30d",
  "#7c3aed",
];
const OTHER_COLOR = "#6b7280";

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
    return {
      ts: it.saleOrder.createdAt.getTime(),
      date: it.saleOrder.createdAt.toLocaleDateString("zh-CN"),
      customer: it.saleOrder.customer.name,
      orderNo: it.saleOrder.orderNo,
      qty,
      unitPrice,
      unitCost,
      amount,
      costAmount,
      profit: amount - costAmount,
    };
  });

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

  // 配色：销售额前 9 的客户各占一色，其余归为「其他客户」
  const customerColors: { customer: string; color: string }[] = byCustomer
    .slice(0, PALETTE.length)
    .map((r, i) => ({ customer: r.customer, color: PALETTE[i] }));
  if (byCustomer.length > PALETTE.length) {
    customerColors.push({ customer: "其他客户", color: OTHER_COLOR });
  }
  const colorMap = new Map(customerColors.map((c) => [c.customer, c.color]));
  const pointColors = points.map((p) => ({
    ...p,
    color: colorMap.get(p.customer) ?? OTHER_COLOR,
  }));

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
    points: pointColors,
    byCustomer,
    customerColors,
    totals,
  };
}
