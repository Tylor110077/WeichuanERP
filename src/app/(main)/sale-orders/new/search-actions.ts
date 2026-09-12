"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { pinyinQuery, searchPinyin } from "@/lib/pinyin";

/**
 * 开单页的"按需搜索"接口。
 *
 * 背景（规模化）：开单页原先一次性把**整个商品目录、整个客户目录、全部历史销售明细**
 * 查出来塞进页面，再在浏览器里过滤。商品/客户上千后，首屏负载随数据总量线性增长。
 *
 * 现在改为：
 * - 首屏只带"最近往来的 N 条"（`recentProductsForOrder` / `recentCustomersForOrder`）；
 * - 用户输入关键词时调用这里搜索（`take: 30`），命中结果替换候选；
 * - 价格/成本参考值在**选中商品后**按需查（`productHintsForOrder`），不再预先把全表拉进内存。
 *
 * 说明：这些 action 只读、只返回开单需要的字段；成本字段仍按角色过滤
 * （业务员不可见成本，与单据详情页 canSeeCost 同口径）。
 */

/** 首屏候选条数（"最近往来"） */
const RECENT_LIMIT = 40;
/** 搜索返回条数上限 */
const SEARCH_LIMIT = 30;

export interface OrderProductOption {
  id: number;
  code: string;
  name: string;
  manufacturer: string;
  unitName: string;
  stockQty: number;
  /** 移动加权均价；业务员拿到的恒为 0（服务端就不下发成本） */
  avgCost: number;
  refSalePrice: number;
  lastSupplierId: number | null;
  lastSupplyPrice: number;
  /** 拼音首字母串（名称/编码/厂家），客户端本地过滤用 */
  py: string;
}

export interface OrderCustomerOption {
  id: number;
  name: string;
  groupName: string;
  tagNames: string[];
  /** 拼音首字母串（名称），客户端本地过滤用 */
  py: string;
}

async function requireOrderUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");
  return user;
}

/** 商品行 → 开单候选（含最近一次进货的厂家与进价，用于自动补货预填） */
async function toProductOptions(ids: number[], canSeeCost: boolean): Promise<OrderProductOption[]> {
  if (ids.length === 0) return [];
  const [products, lastPurchases, suppliers] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: ids }, status: 1 },
      select: {
        id: true,
        code: true,
        name: true,
        manufacturer: true,
        stockQty: true,
        avgCost: true,
        refSalePrice: true,
        refPurchasePrice: true,
        unit: { select: { name: true } },
      },
    }),
    prisma.purchaseOrderItem.findMany({
      where: { productId: { in: ids }, purchaseOrder: { status: { not: "voided" } } },
      orderBy: { purchaseOrder: { createdAt: "desc" } },
      select: { productId: true, unitPrice: true, purchaseOrder: { select: { supplierId: true } } },
    }),
    prisma.supplier.findMany({ where: { status: 1 }, select: { id: true, name: true } }),
  ]);

  const lastByProduct = new Map<number, { supplierId: number; price: number }>();
  for (const p of lastPurchases) {
    if (!lastByProduct.has(p.productId)) {
      lastByProduct.set(p.productId, {
        supplierId: p.purchaseOrder.supplierId,
        price: Number(p.unitPrice),
      });
    }
  }
  const supplierIdByName = new Map(suppliers.map((s) => [s.name, s.id]));
  const byId = new Map(products.map((p) => [p.id, p]));

  // 保持传入的顺序（最近使用优先 / 搜索相关度）
  return ids
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => {
      const last = lastByProduct.get(p.id);
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        manufacturer: p.manufacturer,
        unitName: p.unit.name,
        stockQty: Number(p.stockQty),
        avgCost: canSeeCost ? Number(p.avgCost) : 0,
        refSalePrice: Number(p.refSalePrice),
        lastSupplierId: supplierIdByName.get(p.manufacturer.trim()) ?? last?.supplierId ?? null,
        lastSupplyPrice: last?.price ?? Number(p.refPurchasePrice),
        py: searchPinyin(p.name, p.code, p.manufacturer),
      };
    });
}

/** 首屏候选：最近卖过/进过的商品（按最近使用倒序），不足时用最新建档的商品补齐 */
export async function recentProductsForOrder(): Promise<OrderProductOption[]> {
  const user = await requireOrderUser();
  const canSeeCost = user.role !== "sales";

  const [recentSales, recentPurchases] = await Promise.all([
    prisma.saleOrderItem.findMany({
      where: { saleOrder: { status: "confirmed" } },
      orderBy: { saleOrder: { createdAt: "desc" } },
      take: RECENT_LIMIT * 4,
      select: { productId: true },
    }),
    prisma.purchaseOrderItem.findMany({
      where: { purchaseOrder: { status: { not: "voided" } } },
      orderBy: { purchaseOrder: { createdAt: "desc" } },
      take: RECENT_LIMIT * 4,
      select: { productId: true },
    }),
  ]);

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const it of [...recentSales, ...recentPurchases]) {
    if (!seen.has(it.productId)) {
      seen.add(it.productId);
      ids.push(it.productId);
    }
    if (ids.length >= RECENT_LIMIT) break;
  }
  if (ids.length < RECENT_LIMIT) {
    const fill = await prisma.product.findMany({
      where: { status: 1, id: { notIn: ids } },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT - ids.length,
      select: { id: true },
    });
    ids.push(...fill.map((p) => p.id));
  }
  return toProductOptions(ids, canSeeCost);
}

/** 输入关键词时搜索商品（名称 / 编码 / 厂家，最多 30 条） */
export async function searchProductsForOrder(keyword: string): Promise<OrderProductOption[]> {
  const user = await requireOrderUser();
  const canSeeCost = user.role !== "sales";
  const kw = keyword.trim();
  if (!kw) return [];

  const hits = await prisma.product.findMany({
    where: {
      status: 1,
      OR: [
        { name: { contains: kw } },
        { code: { contains: kw } },
        { manufacturer: { contains: kw } },
        { searchPinyin: { contains: pinyinQuery(kw) } },
      ],
    },
    orderBy: { code: "asc" },
    take: SEARCH_LIMIT,
    select: { id: true },
  });
  return toProductOptions(hits.map((h) => h.id), canSeeCost);
}

/** 选中商品后按需取价格提示（最近成交价、该客户上次成交价） */
export async function productHintsForOrder(
  productId: number,
  customerId?: number | null
): Promise<{ lastSalePrice: number; lastCustomerPrice: number | null }> {
  await requireOrderUser();
  if (!Number.isFinite(productId) || productId <= 0) {
    return { lastSalePrice: 0, lastCustomerPrice: null };
  }

  const [lastSale, lastCustomer] = await Promise.all([
    prisma.saleOrderItem.findFirst({
      where: { productId, saleOrder: { status: "confirmed" } },
      orderBy: { saleOrder: { createdAt: "desc" } },
      select: { unitPrice: true },
    }),
    customerId
      ? prisma.saleOrderItem.findFirst({
          where: { productId, saleOrder: { status: "confirmed", customerId } },
          orderBy: { saleOrder: { createdAt: "desc" } },
          select: { unitPrice: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    lastSalePrice: lastSale ? Number(lastSale.unitPrice) : 0,
    lastCustomerPrice: lastCustomer ? Number(lastCustomer.unitPrice) : null,
  };
}

/** 首屏候选：最近有成交的客户，不足时用最新建档的客户补齐 */
export async function recentCustomersForOrder(): Promise<OrderCustomerOption[]> {
  await requireOrderUser();
  const recent = await prisma.saleOrder.findMany({
    where: { status: "confirmed" },
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT * 4,
    select: { customerId: true },
  });
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const r of recent) {
    if (!seen.has(r.customerId)) {
      seen.add(r.customerId);
      ids.push(r.customerId);
    }
    if (ids.length >= RECENT_LIMIT) break;
  }

  const rows = await prisma.customer.findMany({
    where: { status: 1, ...(ids.length ? { id: { in: ids } } : {}) },
    select: {
      id: true,
      name: true,
      group: { select: { name: true } },
      tagLinks: { select: { tag: { select: { name: true } } } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);

  if (ordered.length < RECENT_LIMIT) {
    const fill = await prisma.customer.findMany({
      where: { status: 1, id: { notIn: ids } },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT - ordered.length,
      select: {
        id: true,
        name: true,
        group: { select: { name: true } },
        tagLinks: { select: { tag: { select: { name: true } } } },
      },
    });
    ordered.push(...fill);
  }

  return ordered.map((c) => ({
    id: c.id,
    name: c.name,
    groupName: c.group?.name ?? "",
    tagNames: c.tagLinks.map((l) => l.tag.name),
    py: searchPinyin(c.name),
  }));
}

/** 输入关键词时搜索客户（名称 / 联系人 / 电话，最多 30 条） */
export async function searchCustomersForOrder(keyword: string): Promise<OrderCustomerOption[]> {
  await requireOrderUser();
  const kw = keyword.trim();
  if (!kw) return [];
  const rows = await prisma.customer.findMany({
    where: {
      status: 1,
      OR: [
        { name: { contains: kw } },
        { contact: { contains: kw } },
        { phone: { contains: kw } },
        { searchPinyin: { contains: pinyinQuery(kw) } },
      ],
    },
    orderBy: { name: "asc" },
    take: SEARCH_LIMIT,
    select: {
      id: true,
      name: true,
      group: { select: { name: true } },
      tagLinks: { select: { tag: { select: { name: true } } } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    groupName: c.group?.name ?? "",
    tagNames: c.tagLinks.map((l) => l.tag.name),
    py: searchPinyin(c.name),
  }));
}
