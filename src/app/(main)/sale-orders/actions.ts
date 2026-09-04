"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { applyStockChange } from "@/lib/stock-cost";
import { buildOrderNo, ORDER_NO_PREFIXES, todayCompact } from "@/lib/order-no";

export type FormState = { error?: string; ok?: string } | null;

const itemSchema = z.object({
  productId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().min(0.001, "数量必须大于 0").max(9_999_999.999),
  unitPrice: z.coerce.number().min(0).max(9_999_999_999.99), // 售价
  supplyPrice: z.coerce.number().min(0).max(9_999_999_999.99), // 自动补货进价
  supplierId: z.coerce.number().int().positive().optional().nullable(), // 缺货行需供应商
});

const createSchema = z.object({
  customerId: z.coerce.number().int().positive("请选择客户"),
  remark: z.string().trim().max(200),
  items: z.array(itemSchema).min(1, "请至少添加一行商品"),
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

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
    items.push({
      productId: formData.get(`item_${i}_productId`),
      quantity: formData.get(`item_${i}_quantity`),
      unitPrice: formData.get(`item_${i}_unitPrice`),
      supplyPrice: formData.get(`item_${i}_supplyPrice`) ?? 0,
      supplierId: formData.get(`item_${i}_supplierId`) || undefined,
    });
    i++;
  }
  return createSchema.safeParse({
    customerId: formData.get("customerId"),
    remark: formData.get("remark") ?? "",
    items,
  });
}

async function nextSeqOf(
  tx: Prisma.TransactionClient,
  model: "purchaseOrder" | "saleOrder",
  prefix: string
): Promise<number> {
  const rows =
    model === "purchaseOrder"
      ? await tx.purchaseOrder.findMany({
          where: { orderNo: { startsWith: `${prefix}${todayCompact()}-` } },
          select: { orderNo: true },
        })
      : await tx.saleOrder.findMany({
          where: { orderNo: { startsWith: `${prefix}${todayCompact()}-` } },
          select: { orderNo: true },
        });
  let maxSeq = 0;
  for (const r of rows) {
    const seq = Number(/-(\d{4})$/.exec(r.orderNo)?.[1] ?? 0);
    if (seq > maxSeq) maxSeq = seq;
  }
  return maxSeq + 1;
}

export async function createSaleOrderAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireSaleWrite();
  const parsed = parseCreatePayload(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  }
  const { customerId, remark, items } = parsed.data;

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.status !== 1) return { error: "客户不存在或已停用" };

  const productIds = [...new Set(items.map((it) => it.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, status: true, unitId: true, manufacturer: true, stockQty: true, stockAmount: true, avgCost: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));
  for (const p of products) {
    if (p.status !== 1) return { error: `商品 #${p.id} 已停用，无法开单` };
  }

  // 归属供应商：缺货行没有指定供应商时，默认使用商品档案的厂商
  // （厂商名无对应供应商档案则自动按厂商名建档，不再需要手选）
  const supplierIds = new Set<number>();
  const mfrNames = new Set<string>();
  for (const it of items) {
    const product = productMap.get(it.productId);
    if (!product) return { error: `商品 #${it.productId} 不存在` };
    const shortfall = Math.max(Number(product.stockQty) < it.quantity ? it.quantity - Number(product.stockQty) : 0, 0);
    if (shortfall > 0) {
      if (it.supplierId) {
        supplierIds.add(it.supplierId);
      } else if (product.manufacturer.trim()) {
        mfrNames.add(product.manufacturer.trim());
      } else {
        return { error: `商品 #${product.id} 缺货且无厂商，请选择补货供应商` };
      }
    }
  }
  if (supplierIds.size > 0) {
    const suppliers = await prisma.supplier.findMany({
      where: { id: { in: [...supplierIds] }, status: 1 },
      select: { id: true },
    });
    if (suppliers.length !== supplierIds.size) return { error: "存在已停用的补货供应商" };
  }
  // 按厂商名确定/创建供应商档案，建立 商品厂商名 → supplierId 映射
  const supplierByMfr = new Map<string, number>();
  if (mfrNames.size > 0) {
    const existing = await prisma.supplier.findMany({
      where: { name: { in: [...mfrNames] } },
      select: { id: true, name: true },
    });
    for (const s of existing) supplierByMfr.set(s.name, s.id);
    for (const name of mfrNames) {
      if (!supplierByMfr.has(name)) {
        const created = await prisma.supplier.create({
          data: { name },
          select: { id: true, name: true },
        });
        supplierByMfr.set(name, created.id);
        await writeAudit({
          userId: user.id,
          action: "create",
          entityType: "supplier",
          entityId: created.id,
          after: { name: created.name, autoFromManufacturer: true },
        });
      }
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // 预取入库后的库存状态并计算每行（数量、成本单价），写流水
        const soSeq = await nextSeqOf(tx, "saleOrder", ORDER_NO_PREFIXES.SO);
        const saleOrderNo = buildOrderNo(ORDER_NO_PREFIXES.SO, soSeq);

        const rowsItem: {
          productId: number;
          quantity: number;
          unitPrice: number;
          costAmount: number;
          avgCost: number;
        }[] = [];

        // ① 缺货行：生成自动补货单（按供应商聚合并即时入库）
        interface AutoItem {
          productId: number;
          quantity: number;
          supplyPrice: number;
          unitId: number;
        }
        const autoGroups = new Map<number, AutoItem[]>();
        for (const it of items) {
          const product = productMap.get(it.productId)!;
          const stock = Number(product.stockQty);
          const shortfall = round3(Math.max(it.quantity - stock, 0));
          if (shortfall > 0) {
            // 供应商：行内指定优先，否则用厂商匹配到的供应商（事务前已兜底建档）
            const supplierId =
              it.supplierId ??
              (product.manufacturer.trim()
                ? supplierByMfr.get(product.manufacturer.trim())
                : undefined);
            if (supplierId == null) {
              throw new Error(`商品 #${product.id} 缺货且无法确定补货供应商`);
            }
            const g = autoGroups.get(supplierId) ?? [];
            g.push({
              productId: it.productId,
              quantity: shortfall,
              supplyPrice: round2(it.supplyPrice),
              unitId: product.unitId,
            });
            autoGroups.set(supplierId, g);
          }
        }
        const saleOrder = await tx.saleOrder.create({
          data: {
            orderNo: saleOrderNo,
            customerId,
            status: "confirmed",
            totalAmount: 0, // 占位，后更新
            operatorId: user.id,
            remark: remark || null,
          },
          select: { id: true },
        });

        for (const [supplierId, autoItems] of autoGroups) {
          const poSeq = await nextSeqOf(tx, "purchaseOrder", ORDER_NO_PREFIXES.PO);
          const poNo = buildOrderNo(ORDER_NO_PREFIXES.PO, poSeq);
          const poTotal = round2(autoItems.reduce((s, a) => s + a.quantity * a.supplyPrice, 0));
          const po = await tx.purchaseOrder.create({
            data: {
              orderNo: poNo,
              supplierId,
              status: "received", // 生成即入库（评审决议 v0.3）
              sourceType: "auto",
              sourceSaleOrderId: saleOrder.id,
              totalAmount: poTotal,
              receivedAt: new Date(),
              operatorId: user.id,
            },
            select: { id: true },
          });
          for (const a of autoItems) {
            const product = await tx.product.findUnique({
              where: { id: a.productId },
              select: { stockQty: true, stockAmount: true, avgCost: true },
            });
            if (!product) throw new Error(`商品 #${a.productId} 不存在`);
            const before = { qty: Number(product.stockQty), amount: Number(product.stockAmount), avgCost: Number(product.avgCost) };
            const next = applyStockChange(before, a.quantity, a.supplyPrice);
            await tx.product.update({
              where: { id: a.productId },
              data: { stockQty: next.qty, stockAmount: next.amount, avgCost: next.avgCost },
            });
            await tx.stockMovement.create({
              data: {
                productId: a.productId,
                changeQty: a.quantity,
                beforeQty: before.qty,
                afterQty: next.qty,
                unitCost: a.supplyPrice,
                bizType: "purchase_in",
                bizOrderNo: poNo,
                operatorId: user.id,
              },
            });
            await tx.purchaseOrderItem.create({
              data: {
                purchaseOrderId: po.id,
                productId: a.productId,
                quantity: a.quantity,
                unitId: a.unitId,
                unitPrice: a.supplyPrice,
                amount: round2(a.quantity * a.supplyPrice),
              },
            });
          }
          await writeAudit({
            userId: user.id,
            action: "create",
            entityType: "purchase_order",
            entityId: po.id,
            after: { orderNo: poNo, supplierId, sourceSaleOrderId: saleOrder.id, auto: true },
          });
        }

        // ② 扣库存 + 成本快照（此时 avg_cost 已含补货入库）
        for (const it of items) {
          const qty = round3(it.quantity);
          // 补货后库存 = 原库存 + shortfall（>= quantity）；重读一次以确保事务内一致性
          const now = await tx.product.findUnique({
            where: { id: it.productId },
            select: { stockQty: true, stockAmount: true, avgCost: true },
          });
          if (!now) throw new Error(`商品 #${it.productId} 不存在`);
          const cur = { qty: Number(now.stockQty), amount: Number(now.stockAmount), avgCost: Number(now.avgCost) };
          if (cur.qty < qty) throw new Error(`商品 #${it.productId} 库存不足（${cur.qty} < ${qty}）`);
          const next = applyStockChange(cur, -qty, cur.avgCost);
          await tx.product.update({
            where: { id: it.productId },
            data: { stockQty: next.qty, stockAmount: next.amount, avgCost: next.avgCost },
          });
          await tx.stockMovement.create({
            data: {
              productId: it.productId,
              changeQty: -qty,
              beforeQty: cur.qty,
              afterQty: next.qty,
              unitCost: cur.avgCost,
              bizType: "sale_out",
              bizOrderNo: saleOrderNo,
              operatorId: user.id,
            },
          });
          rowsItem.push({
            productId: it.productId,
            quantity: qty,
            unitPrice: round2(it.unitPrice),
            costAmount: round2(qty * cur.avgCost),
            avgCost: cur.avgCost,
          });
        }

        const totalAmount = round2(rowsItem.reduce((s, r) => s + r.quantity * r.unitPrice, 0));
        await tx.saleOrder.update({ where: { id: saleOrder.id }, data: { totalAmount } });
        for (const r of rowsItem) {
          await tx.saleOrderItem.create({
            data: {
              saleOrderId: saleOrder.id,
              productId: r.productId,
              quantity: r.quantity,
              unitId: productMap.get(r.productId)!.unitId,
              unitPrice: r.unitPrice,
              amount: round2(r.quantity * r.unitPrice),
              costAmount: r.costAmount,
            },
          });
        }
        return { id: saleOrder.id, orderNo: saleOrderNo, totalAmount };
      });

      await writeAudit({
        userId: user.id,
        action: "create",
        entityType: "sale_order",
        entityId: result.id,
        after: { orderNo: result.orderNo, customerId, totalAmount: result.totalAmount },
      });
      revalidatePath("/sale-orders");
      redirect("/sale-orders");
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        continue; // 序号冲突重试
      }
      if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT")) throw err;
      console.error("[sale] 开单失败:", err);
      return { error: err instanceof Error ? err.message : "开单失败，请重试" };
    }
  }
  return { error: "单据号生成失败，请重试" };
}

/** 作废售卖单：库存冲回（sale_out 反向），其自动补货单级联作废并冲回。 */
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
    include: { items: true, autoRestockOrders: { include: { items: true } } },
  });
  if (!order) return { error: "售卖单不存在" };
  if (order.status === "voided") return { error: "单据已作废" };

  try {
    await prisma.$transaction(async (tx) => {
      // ① 售卖行库存回补（按当前移动加权成本）
      for (const item of order.items) {
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
