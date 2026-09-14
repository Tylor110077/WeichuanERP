"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { optionalNumber, requiredNumber } from "@/lib/form-number";
import { fillEstimate } from "@/lib/services/orders/estimate-fill";
import { humanActor } from "@/lib/cli/types";

export type FillState = { error?: string; ok?: string } | null;

const schema = z.object({
  itemId: z.coerce.number().int().positive(),
  supplierId: z.coerce.number().int().positive("请选择厂家"),
  unitPrice: requiredNumber({
    invalid: "请填写进价",
    min: 0,
    max: 9_999_999_999.99,
    maxMessage: "进价格式不正确",
  }).refine((v) => v > 0, "进价必须大于 0"),
  productName: z.string().trim().max(100),
  /** 分类：留空＝未分类（与商品档案当前值比较后才写，见下方 patch） */
  categoryId: optionalNumber({ invalid: "分类不正确", min: 1 }),
  /** 参考进价：留空＝不改商品档案里的值（下次开单的默认进价） */
  refPurchasePrice: optionalNumber({
    invalid: "参考进价必须是数字",
    min: 0,
    max: 9_999_999_999.99,
    minMessage: "参考进价不能为负",
    maxMessage: "参考进价过大",
  }),
});


/**
 * 估价待补：把一行的真实进价与货源补上。
 *
 * 做三件事（同一个事务里）：
 * 1. 生成一张**待收货**的进货单（挂到触发它的售卖单上，这样售卖单作废时会一并作废）；
 * 2. 把成本写回原售卖单的那一行（成本快照 = 数量 × 进价）；
 * 3. 如果开单时用的是临时商品名/没有厂家，顺手把商品档案补正、并记下厂家。
 *
 * 为什么补成本是安全的：估价行不消耗库存、也没参与移动加权成本，
 * 所以写回只影响这一张单自己的毛利，不会牵动其它单据。
 * 库存要等这张进货单「确认入库」才进——那一步仍走既有的入库逻辑。
 */
export async function fillEstimatedAction(_prev: FillState, formData: FormData): Promise<FillState> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { error: "仅管理员可补单" };

  // 薄壳：解析表单 → 调服务层 → 刷新（逻辑在 lib/services/orders/estimate-fill.ts，与 CLI 共用）
  const parsed = schema.safeParse({
    itemId: formData.get("itemId"),
    supplierId: formData.get("supplierId"),
    unitPrice: formData.get("unitPrice"),
    productName: formData.get("productName") || undefined,
    categoryId: formData.get("categoryId") || undefined,
    refPurchasePrice: formData.get("refPurchasePrice") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "输入有误" };

  const item = await prisma.saleOrderItem.findUnique({ where: { id: parsed.data.itemId }, select: { saleOrderId: true } });
  const result = await fillEstimate(humanActor(admin), parsed.data, { dryRun: false });
  if (!result.ok) return { error: result.error.message };

  const plan = result.data.plan as { 补单进货单: { orderNo: string }; 成本已写回原行: string };
  revalidatePath("/pending-estimates");
  revalidatePath("/purchase-orders");
  if (item) revalidatePath(`/sale-orders/${item.saleOrderId}`);
  return { ok: `已生成进货单 ${plan.补单进货单.orderNo}（待收货），成本 ¥${plan.成本已写回原行} 已写回本行` };
}
