"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { applyStockChange } from "@/lib/stock-cost";
import { firstIssueMessage, optionalNumber, requiredNumber } from "@/lib/form-number";
import { createSaleOrder } from "@/lib/services/orders/sale-create";
import { humanActor } from "@/lib/cli/types";

export type FormState = { error?: string; ok?: string } | null;

const itemSchema = z.object({
  productId: z.coerce.number().int().positive("请选择商品"),
  /** 估价待补：只填售价，进价与货源后补 */
  estimated: z.boolean().optional(),
  /** 行内单位（估价行可选/可就地新建）；不传就用商品的单位 */
  unitId: z.coerce.number().int().positive().optional(),
  quantity: requiredNumber({
    invalid: "请填写数量",
    min: 0.001,
    minMessage: "数量必须大于 0",
    max: 9_999_999.999,
    maxMessage: "数量过大",
  }),
  unitPrice: requiredNumber({
    invalid: "请填写售价",
    min: 0,
    max: 9_999_999_999.99,
    maxMessage: "售价格式不正确",
  }), // 售价
  supplyPrice: requiredNumber({
    invalid: "请填写进价",
    min: 0,
    max: 9_999_999_999.99,
    maxMessage: "进价格式不正确",
  }), // 自动补货进价
  supplierId: z.coerce.number().int().positive().optional().nullable(), // 缺货行需厂家
  // 多补：在自动补足缺口之外额外多进的备货量（不允许负数）；不填＝不多补
  extraQty: optionalNumber({
    invalid: "多补必须是数字",
    min: 0,
    minMessage: "多补不能为负",
    max: 9_999_999.999,
    maxMessage: "多补过大",
  }).default(0),
  remark: z.string().trim().max(200).optional().default(""), // 行备注
  // 本次使用的现有库存数量（留空＝尽量用库存；填 0＝全部现场进货）
  // 留空必须视为「未填写」而不是 0，见 src/lib/form-number.ts 的说明
  stockUsed: optionalNumber({
    invalid: "用库存必须是数字",
    min: 0,
    minMessage: "用库存不能为负",
    max: 9_999_999.999,
    maxMessage: "用库存过大",
  }),
});

const createSchema = z.object({
  customerId: z.coerce.number().int().positive("请选择客户"),
  remark: z.string().trim().max(200),
  items: z.array(itemSchema).min(1, "请至少添加一行商品"),
});

/** 行字段的中文标签（报错说成「第 2 行「售价」：…」而不是字段名） */
const ITEM_LABELS = { unitPrice: "售价", supplyPrice: "进价" };


async function requireSaleWrite() {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");
  if (user.role === "boss") throw new Error("老板/财务无销售开单权限");
  return user;
}

function parseCreatePayload(formData: FormData) {
  const items: unknown[] = [];
  let i = 0;
  while (formData.has(`item_${i}_productId`)) {
    // 未选择商品的空行直接跳过（加行后未填写不应阻塞提交）
    if (!String(formData.get(`item_${i}_productId`) || "").trim()) {
      i++;
      continue;
    }
    items.push({
      productId: formData.get(`item_${i}_productId`),
      quantity: formData.get(`item_${i}_quantity`),
      unitPrice: formData.get(`item_${i}_unitPrice`),
      supplyPrice: formData.get(`item_${i}_supplyPrice`) ?? 0,
      supplierId: formData.get(`item_${i}_supplierId`) || undefined,
      extraQty: formData.get(`item_${i}_extraQty`) || 0,
      remark: formData.get(`item_${i}_remark`) || "",
      stockUsed: formData.get(`item_${i}_stockUsed`) ?? undefined,
      // 估价待补：这一行只知道售价，进价与货源后补（不消耗库存、不自动补货）
      estimated: formData.get(`item_${i}_estimated`) === "1",
      unitId: formData.get(`item_${i}_unitId`) || undefined,
    });
    i++;
  }
  return createSchema.safeParse({
    customerId: formData.get("customerId"),
    remark: formData.get("remark") ?? "",
    items,
  });
}


export async function createSaleOrderAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireSaleWrite();

  // 薄壳：解析表单 → 调服务层 → 刷新与跳转。
  // 业务逻辑（库存扣减、成本快照、自动补货、审计）全在 lib/services/orders/sale-create.ts，
  // 与 CLI 走的是同一份代码——所以"页面开出来的单"和"CLI 开出来的单"不可能不一致。
  const parsed = parseCreatePayload(formData);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error, ITEM_LABELS) };
  }
  const { customerId, remark, items } = parsed.data;

  const result = await createSaleOrder(
    humanActor(user),
    { customerId, remark, items, starred: formData.get("starred") === "1" },
    { dryRun: false }
  );
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/sale-orders");
  redirect("/sale-orders");
}

export async function voidSaleOrderAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };
  if (user.role === "sales") return { error: "业务员无作废权限" };

  const id = Number(formData.get("id"));
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  if (!reason) return { error: "请填写作废原因" };

  const order = await prisma.saleOrder.findUnique({
    where: { id },
    include: {
      items: true,
      autoRestockOrders: { include: { items: true } },
      returns: { where: { status: "confirmed" }, select: { orderNo: true, totalAmount: true } },
    },
  });
  if (!order) return { error: "售卖单不存在" };
  if (order.status === "voided") return { error: "单据已作废" };

  // 已有确认退货的单不许直接作废：退货已经把货补回库存一次，作废再按整单补一遍就是**多补**。
  // 与其静默把库存补错，不如让操作者先处理退货（作废退货单或改单），把决定权交回给人。
  if (order.returns.length > 0) {
    const nos = order.returns.map((r) => r.orderNo).join("、");
    return {
      error: `本单已有 ${order.returns.length} 张退货单（${nos}），不能直接作废——否则库存会被重复补回。请先作废那些退货单，或改用「改单」。`,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // ① 售卖行库存回补（按当前移动加权成本）
      for (const item of order.items) {
        // 估价行跳过：开单时它不占库存（stockQtyUsed / purchaseQty 都是 0），
        // 也没有对应的自动补货单。按 quantity 加回去等于凭空造库存。
        if (item.estimated) continue;
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { stockQty: true, stockAmount: true, avgCost: true },
        });
        if (!product) throw new Error(`商品 #${item.productId} 不存在`);
        const before = { qty: Number(product.stockQty), amount: Number(product.stockAmount), avgCost: Number(product.avgCost) };
        const next = applyStockChange(before, Number(item.quantity), before.avgCost);
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQty: next.qty, stockAmount: next.amount, avgCost: next.avgCost },
        });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            changeQty: Number(item.quantity),
            beforeQty: before.qty,
            afterQty: next.qty,
            unitCost: before.avgCost,
            bizType: "void_reverse",
            bizOrderNo: order.orderNo,
            operatorId: user.id,
          },
        });
      }
      // ② 级联作废自动补货单（生成即入库的补货需冲回）
      for (const po of order.autoRestockOrders) {
        for (const item of po.items) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { stockQty: true, stockAmount: true, avgCost: true },
          });
          if (!product) throw new Error(`商品 #${item.productId} 不存在`);
          const before = { qty: Number(product.stockQty), amount: Number(product.stockAmount), avgCost: Number(product.avgCost) };
          if (before.qty < Number(item.quantity)) {
            throw new Error(`商品 #${item.productId} 库存不足，无法级联冲回补货单 ${po.orderNo}`);
          }
          const next = applyStockChange(before, -Number(item.quantity), before.avgCost);
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQty: next.qty, stockAmount: next.amount, avgCost: next.avgCost },
          });
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              changeQty: -Number(item.quantity),
              beforeQty: before.qty,
              afterQty: next.qty,
              unitCost: before.avgCost,
              bizType: "void_reverse",
              bizOrderNo: po.orderNo,
              operatorId: user.id,
            },
          });
        }
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: "voided", voidedBy: user.id, voidedAt: new Date(), voidReason: `随售卖单作废：${order.orderNo}` },
        });
        await writeAudit({
          userId: user.id,
          action: "void",
          entityType: "purchase_order",
          entityId: po.id,
          // tx：级联作废与审计同事务，避免"审计写了作废、实际作废失败"的残留
          tx,
          before: { orderNo: po.orderNo, status: po.status },
          after: { orderNo: po.orderNo, status: "voided", voidReason: `随售卖单作废：${order.orderNo}` },
        });
      }
      await tx.saleOrder.update({
        where: { id },
        data: { status: "voided", voidedBy: user.id, voidedAt: new Date(), voidReason: reason },
      });
    });

    await writeAudit({
      userId: user.id,
      action: "void",
      entityType: "sale_order",
      entityId: id,
      before: { orderNo: order.orderNo, status: order.status },
      after: { orderNo: order.orderNo, status: "voided", voidReason: reason, cascaded: order.autoRestockOrders.length },
    });
    revalidatePath(`/sale-orders/${id}`);
    revalidatePath("/sale-orders");
    return { ok: "已作废，库存已冲回" };
  } catch (err) {
    console.error("[sale] 作废失败:", err);
    return { error: err instanceof Error ? err.message : "作废失败，请重试" };
  }
}

/**
 * 星标开关（列表行与详情页共用）。
 * 不是财务操作，不做二次确认；业务员只能标自己开的单（与退货同口径）。
 */
export async function toggleSaleOrderStarAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const id = Number(formData.get("id"));
  const starred = formData.get("starred") === "1";
  if (!Number.isInteger(id) || id <= 0) return;

  const order = await prisma.saleOrder.findUnique({
    where: { id },
    select: { id: true, operatorId: true, starred: true },
  });
  if (!order || order.starred === starred) return;
  if (user.role === "sales" && order.operatorId !== user.id) return;

  await prisma.saleOrder.update({ where: { id }, data: { starred } });
  await writeAudit({
    userId: user.id,
    action: "update",
    entityType: "sale_order",
    entityId: id,
    before: { starred: order.starred },
    after: { starred },
  });
  revalidatePath("/sale-orders");
  revalidatePath(`/sale-orders/${id}`);
}
