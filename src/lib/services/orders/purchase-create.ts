import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { buildOrderNo, nextOrderSeq, ORDER_NO_PREFIXES } from "@/lib/order-no";
import { requiredNumber } from "@/lib/form-number";
import { runInTransaction } from "@/lib/services/dry-run";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 开进货单（服务层；网页 action 与 CLI 共用）。
 *
 * 口径照抄 src/app/(main)/purchase-orders/actions.ts，改动必须同步改页面：
 * - **创建 ≠ 入库**：状态是 `pending`，库存与移动加权成本**一动不动**；
 *   货到了要在「确认入库」那一步才进库存（那是另一个模块）
 * - 单位取商品默认单位（文档：不做换算，单单位制）
 * - sourceType = manual
 * - 老板/财务无进货开单权限（与 requirePurchaseWrite 同一句话）
 *
 * 与网页版的有意差别：审计写在同一事务内（A5 裁决），不再事后补写。
 */

const itemSchema = z.object({
  productId: z.coerce.number().int().positive("请选择商品"),
  quantity: requiredNumber({ invalid: "请填写数量", min: 0.001, minMessage: "数量必须大于 0", max: 9_999_999.999, maxMessage: "数量过大" }),
  unitPrice: requiredNumber({ invalid: "请填写进价", min: 0, max: 9_999_999_999.99, maxMessage: "进价格式不正确" }),
  remark: z.string().trim().max(200).optional().default(""),
});

const createSchema = z.object({
  supplierId: z.coerce.number().int().positive("请选择厂家"),
  remark: z.string().trim().max(200).optional().default(""),
  starred: z.boolean().optional(),
  items: z.array(itemSchema).min(1, "请至少添加一行商品"),
});

export type CreatePurchaseOrderInput = z.input<typeof createSchema>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export async function createPurchaseOrder(
  actor: Actor,
  rawInput: CreatePurchaseOrderInput,
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  // 与网页 requirePurchaseWrite 同一句话：老板/财务不能开进货单。
  // 判定必须在服务层——CLI 不经过 action。
  if (actor.role === "boss") return fail("FORBIDDEN", "老板/财务无进货开单权限");

  const parsed = createSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "输入有误");
  const { supplierId, remark, items } = parsed.data;
  const starred = parsed.data.starred ?? false;

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true, status: true } });
  if (!supplier || supplier.status !== 1) return fail("RULE", "厂家不存在或已停用");

  const productIds = [...new Set(items.map((it) => it.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, status: true, unitId: true, code: true, name: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));
  for (const p of products) {
    if (p.status !== 1) return fail("RULE", `商品 #${p.id} 已停用，无法开单`);
  }
  for (const it of items) {
    if (!productMap.has(it.productId)) return fail("INVALID", `商品 #${it.productId} 不存在`);
  }

  const normalized = items.map((it) => ({
    productId: it.productId,
    unitId: productMap.get(it.productId)!.unitId,
    quantity: round3(it.quantity),
    unitPrice: round2(it.unitPrice),
    remark: it.remark || null,
  }));

  try {
    const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
      const no = buildOrderNo(
        ORDER_NO_PREFIXES.PO,
        await nextOrderSeq(ORDER_NO_PREFIXES.PO, (like) =>
          tx.purchaseOrder.findMany({ where: { orderNo: { startsWith: like } }, select: { orderNo: true } })
        )
      );
      const itemsWithAmount = normalized.map((it) => ({ ...it, amount: round2(it.quantity * it.unitPrice) }));
      const totalAmount = round2(itemsWithAmount.reduce((s, it) => s + it.amount, 0));
      const created = await tx.purchaseOrder.create({
        data: {
          orderNo: no,
          supplierId,
          status: "pending",
          sourceType: "manual",
          starred,
          totalAmount,
          remark: remark || null,
          operatorId: actor.userId,
          items: { create: itemsWithAmount.map((it) => ({ ...it })) },
        },
        select: { id: true, orderNo: true },
      });
      await writeAudit({
        userId: actor.userId,
        action: "create",
        entityType: "purchase_order",
        entityId: created.id,
        tx,
        ip: "cli",
        after: {
          orderNo: created.orderNo,
          supplierId,
          totalAmount,
          source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web",
          runId: actor.runId ?? null,
        },
      });
      return {
        单据: { id: created.id, orderNo: created.orderNo },
        厂家: supplier.name,
        金额合计: totalAmount.toFixed(2),
        状态: "待收货（创建不等于入库，货到了要在「确认入库」那一步才进库存）",
        行: itemsWithAmount.map((it) => ({
          商品: `${productMap.get(it.productId)!.code} ${productMap.get(it.productId)!.name}`,
          数量: it.quantity.toFixed(3),
          进价: it.unitPrice.toFixed(2),
          金额: it.amount.toFixed(2),
        })),
      };
    });
    return ok({ committed, dryRun: !committed, ...(committed ? {} : { 说明: "这是预演，什么都没写。确认后加 --yes" }), plan });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return fail("CONFLICT", "进货单号冲突（并发），请重试");
    }
    console.error("[purchase-order.create] 失败:", e);
    return fail("INTERNAL", e instanceof Error ? e.message : "开单失败");
  }
}
