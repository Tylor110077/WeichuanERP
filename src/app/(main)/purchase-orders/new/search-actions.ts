"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { pinyinQuery } from "@/lib/pinyin";

/**
 * 进货开单页的「按需搜索」接口。
 *
 * 背景：进货单原来把**整个厂家目录和整个商品目录**一次性塞进页面（首屏负载随主数据增长），
 * 现在改为首屏只带"最近往来"的若干条，其余在输入关键词时向服务端要（与销售开单页同一套做法）。
 *
 * 只读、只返回开单需要的字段；权限与开单页一致（管理员/业务员）。
 */

const LIMIT = 30;

export interface PurchaseSupplierOption {
  id: number;
  name: string;
}

export interface PurchaseProductOption {
  id: number;
  /** 「编码 名称（厂家）」，下拉里一眼看清是哪个厂家的哪个货 */
  label: string;
  unitId: number;
  unitName: string;
  /** 默认进价：最近一次进价，没有则用商品档案的参考进价 */
  refPrice: number;
}

async function requirePurchaseUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");
  if (user.role === "boss") throw new Error("无开进货单权限");
  return user;
}

/** 输入关键词时搜索厂家（名称，支持拼音首字母） */
export async function searchSuppliersForPurchase(
  keyword: string
): Promise<PurchaseSupplierOption[]> {
  await requirePurchaseUser();
  const kw = keyword.trim();
  if (!kw) return [];
  return prisma.supplier.findMany({
    where: {
      status: 1,
      OR: [{ name: { contains: kw } }, { searchPinyin: { contains: pinyinQuery(kw) } }],
    },
    orderBy: { name: "asc" },
    take: LIMIT,
    select: { id: true, name: true },
  });
}

/** 输入关键词时搜索商品（名称/编码/厂家，支持拼音首字母） */
export async function searchProductsForPurchase(
  keyword: string
): Promise<PurchaseProductOption[]> {
  await requirePurchaseUser();
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
    take: LIMIT,
    select: {
      id: true,
      code: true,
      name: true,
      manufacturer: true,
      unitId: true,
      unit: { select: { name: true } },
      refPurchasePrice: true,
    },
  });
  if (hits.length === 0) return [];

  // 默认进价取"最近一次进价"（各自取最新一笔非作废进货）
  const lastItems = await prisma.purchaseOrderItem.findMany({
    where: { productId: { in: hits.map((h) => h.id) }, purchaseOrder: { status: { not: "voided" } } },
    orderBy: { purchaseOrder: { createdAt: "desc" } },
    select: { productId: true, unitPrice: true },
  });
  const lastByProduct = new Map<number, number>();
  for (const it of lastItems) {
    if (!lastByProduct.has(it.productId)) lastByProduct.set(it.productId, Number(it.unitPrice));
  }

  return hits.map((h) => ({
    id: h.id,
    label: `${h.code} ${h.name}（${h.manufacturer || "未填厂家"}）`,
    unitId: h.unitId,
    unitName: h.unit.name,
    refPrice: lastByProduct.get(h.id) ?? Number(h.refPurchasePrice),
  }));
}
