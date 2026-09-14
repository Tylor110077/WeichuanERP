import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditIp, auditProvenance, writeAudit } from "@/lib/audit";
import { buildOrderNo, nextOrderSeq, ORDER_NO_PREFIXES } from "@/lib/order-no";
import { requiredNumber } from "@/lib/form-number";
import { runInTransaction } from "@/lib/services/dry-run";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 估价补单（服务层；网页 action 与 CLI 共用）。
 *
 * 口径照抄 src/app/(main)/pending-estimates/actions.ts，改动必须同步改页面。
 * 一个事务里做三件事：
 * 1. 生成一张**待收货**的进货单（挂到触发它的售卖单上，这样售卖单作废时会一并作废）
 * 2. 把成本写回原售卖单那一行（成本快照 = 数量 × 进价），并记 `estimatedResolvedAt`
 * 3. 顺手补正临时商品的档案（品名/厂家/分类/参考进价，**只写与当前值不同的字段**）
 *
 * 为什么补成本是安全的：估价行不消耗库存、也没参与移动加权成本，
 * 写回只影响这一张单自己的毛利，不牵动其它单据。
 * 库存要等这张进货单「确认入库」才进——那一步走既有的入库逻辑。
 *
 * 权限：**仅管理员**（与页面的 requireAdmin 一致）。判定在服务层——CLI 不经过 action。
 */

const schema = z.object({
  itemId: z.coerce.number().int().positive("请指定估价行 --item-id"),
  supplierId: z.coerce.number().int().positive("请指定厂家 --supplier-id"),
  unitPrice: requiredNumber({ invalid: "请填写进价", min: 0, max: 9_999_999_999.99, maxMessage: "进价格式不正确" }).refine(
    (v) => v > 0,
    "进价必须大于 0"
  ),
  /** 品名可改（开单时用的临时名）；留空＝不改 */
  productName: z.string().trim().max(100).optional(),
  /** 分类可补；留空＝不改 */
  categoryId: z.coerce.number().int().positive().optional(),
  /** 参考进价可补；留空＝不改 */
  refPurchasePrice: z.coerce.number().min(0).max(9_999_999_999.99).optional(),
});

export type FillEstimateInput = z.input<typeof schema>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toFixed(2);

export async function fillEstimate(
  actor: Actor,
  rawInput: FillEstimateInput,
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role !== "admin") return fail("FORBIDDEN", "仅管理员可补单");
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "输入有误");
  const { itemId, supplierId, unitPrice, productName, categoryId, refPurchasePrice } = parsed.data;

  const item = await prisma.saleOrderItem.findUnique({
    where: { id: itemId },
    include: {
      product: { select: { id: true, code: true, name: true, unitId: true, manufacturer: true, categoryId: true, refPurchasePrice: true } },
      saleOrder: { select: { id: true, orderNo: true, status: true } },
    },
  });
  if (!item) return fail("NOT_FOUND", `找不到估价行：#${itemId}`);
  if (!item.estimated) return fail("RULE", `这一行不是估价行（id=${itemId}）`);
  if (item.estimatedResolvedAt) return fail("RULE", "这一行已经补过了");
  if (item.saleOrder.status !== "confirmed") return fail("RULE", "原售卖单已作废，无需补单");

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true, status: true } });
  if (!supplier) return fail("NOT_FOUND", `厂家不存在：#${supplierId}`);
  if (supplier.status !== 1) return fail("RULE", "厂家已停用，请换一个或先启用");

  const qty = Number(item.quantity);
  const costAmount = round2(qty * unitPrice);

  try {
    const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
      const poNo = buildOrderNo(
        ORDER_NO_PREFIXES.PO,
        await nextOrderSeq(ORDER_NO_PREFIXES.PO, (like) =>
          tx.purchaseOrder.findMany({ where: { orderNo: { startsWith: like } }, select: { orderNo: true } })
        )
      );
      const po = await tx.purchaseOrder.create({
        data: {
          orderNo: poNo,
          supplierId,
          status: "pending",
          sourceType: "auto",
          sourceSaleOrderId: item.saleOrder.id,
          totalAmount: costAmount,
          remark: `估价补单（原单 ${item.saleOrder.orderNo}）`,
          operatorId: actor.userId,
          items: {
            create: [{ productId: item.productId, unitId: item.product.unitId, quantity: qty, unitPrice, amount: costAmount, restockQty: qty }],
          },
        },
        select: { id: true, orderNo: true },
      });

      // 成本写回原行（估价行没参与过移动加权成本，写回只影响本单毛利）
      await tx.saleOrderItem.update({
        where: { id: itemId },
        data: { costAmount, estimatedResolvedAt: new Date(), estimatedPurchaseOrderId: po.id },
      });

      // 商品档案补正：只写「与当前值不同」的字段（表单是预填的，未改动的字段不该产生写操作）
      const patch: { name?: string; manufacturer?: string; categoryId?: number | null; refPurchasePrice?: number } = {};
      if (productName && productName !== item.product.name) patch.name = productName;
      if (supplier.name && supplier.name !== item.product.manufacturer) patch.manufacturer = supplier.name;
      if (categoryId !== (item.product.categoryId ?? undefined)) patch.categoryId = categoryId ?? null;
      if (refPurchasePrice != null && refPurchasePrice !== Number(item.product.refPurchasePrice)) {
        patch.refPurchasePrice = refPurchasePrice;
      }
      if (Object.keys(patch).length > 0) {
        await tx.product.update({ where: { id: item.productId }, data: patch });
      }

      await writeAudit({
        userId: actor.userId,
        action: "update",
        entityType: "sale_order_item",
        entityId: itemId,
        tx,
        ip: auditIp(actor),
        ...auditProvenance(actor),
        before: { estimated: true, costAmount: Number(item.costAmount) },
        after: {
          补单进货单: po.orderNo,
          supplierId,
          unitPrice,
          costAmount,
          商品档案补正: Object.keys(patch).length > 0 ? patch : undefined,
          source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web",
          runId: actor.runId ?? null,
        },
      });

      return {
        估价行: { id: itemId, 原售卖单: item.saleOrder.orderNo, 商品: `${item.product.code} ${item.product.name}`, 数量: qty.toFixed(3) },
        补单进货单: { orderNo: po.orderNo, 状态: "待收货（库存要等确认入库才进）", 金额: money(costAmount) },
        成本已写回原行: money(costAmount),
        商品档案补正: Object.keys(patch).length > 0 ? patch : "（无改动）",
      };
    });
    return ok({ committed, dryRun: !committed, ...(committed ? {} : { 说明: "这是预演，什么都没写。确认后加 --yes" }), plan });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return fail("CONFLICT", "进货单号冲突（并发），请重试");
    }
    console.error("[estimate.fill] 失败:", e);
    return fail("INTERNAL", e instanceof Error ? e.message : "补单失败");
  }
}
