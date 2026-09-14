"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, type TxClient } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { applyStockChange } from "@/lib/stock-cost";
import { buildOrderNo, ORDER_NO_PREFIXES, todayCompact } from "@/lib/order-no";
import { firstIssueMessage, optionalNumber, requiredNumber } from "@/lib/form-number";

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

async function nextSeqOf(
  tx: TxClient,
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
    return { error: firstIssueMessage(parsed.error, ITEM_LABELS) };
  }
  const { customerId, remark, items } = parsed.data;
  // 开单时就能标星（表单客户信息区里那个星按钮）
  const starred = formData.get("starred") === "1";

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

  // 归属厂家：缺货行没有指定厂家时，默认使用商品档案的厂家
  // （厂家名无对应厂家档案则自动按厂家名建档，不再需要手选）
  const supplierIds = new Set<number>();
  const mfrNames = new Set<string>();
  for (const it of items) {
    const product = productMap.get(it.productId);
    if (!product) return { error: `商品 #${it.productId} 不存在` };
    // 估价行不占库存、不补货（下方计划逻辑已把它的用量与补货量全部归零），因此也不需要补货厂家
    if (it.estimated) continue;
    const shortfall = Math.max(Number(product.stockQty) < it.quantity ? it.quantity - Number(product.stockQty) : 0, 0);
    if (shortfall > 0) {
      if (it.supplierId) {
        supplierIds.add(it.supplierId);
      } else if (product.manufacturer.trim()) {
        mfrNames.add(product.manufacturer.trim());
      } else {
        return { error: `商品 #${product.id} 缺货且无厂家，请选择补货厂家` };
      }
    }
  }
  if (supplierIds.size > 0) {
    const suppliers = await prisma.supplier.findMany({
      where: { id: { in: [...supplierIds] }, status: 1 },
      select: { id: true },
    });
    if (suppliers.length !== supplierIds.size) return { error: "存在已停用的补货厂家" };
  }
  // 按厂家名确定/创建厂家档案，建立 商品厂家名 → supplierId 映射
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
          unitId: number;
          unitPrice: number;
          costAmount: number;
          avgCost: number;
          remark: string;
          stockQtyUsed: number;
          /** 估价待补行：成本先记 0，等补单时写回 */
          estimated: boolean;
        }[] = [];

        // ① 逐行计划：本次用多少现有库存、现场进货多少
        //    库存部分成本＝入库前移动加权成本（不可改）；现场进货部分成本＝开单时填写的进价（可自定）
        interface LinePlan {
          productId: number;
          qty: number; // 客户需求数量
          stockUsed: number; // 使用现有库存的数量
          purchaseQty: number; // 现场进货的数量（客户需求部分）
          extraQty: number; // 额外多补（备货，不计入该客户）
          restockTotal: number; // 补货单数量 = 现场进货 + 多补
          estimated: boolean; // 估价待补行：不占库存、不补货、成本后补
          supplyPrice: number;
          unitId: number;
          remark: string;
          stockCost: number;
          purchaseCost: number;
        }
        interface AutoItem {
          productId: number;
          quantity: number; // 本次补货总量（含备货）
          stockExtra: number; // 其中属于自有备货的部分（不计入该客户）
          supplyPrice: number;
          unitId: number;
        }
        const autoGroups = new Map<number, AutoItem[]>();
        const plans: LinePlan[] = [];
        for (const it of items) {
          const product = productMap.get(it.productId)!;
          const qty = round3(it.quantity);
          const stock = Math.max(Number(product.stockQty), 0);
          /** 估价行：只记售价，不占库存、不算成本，也就不会产生自动补货进货单 */
          const estimated = !!it.estimated;
          // 用库存量：留空＝尽量用库存；可改小甚至填 0（全部现场进货），上限为库存与需求量
          const requested =
            it.stockUsed == null ? Math.min(stock, qty) : Math.max(Number(it.stockUsed), 0);
          const stockUsed = estimated ? 0 : round3(Math.min(requested, stock, qty));
          const purchaseQty = estimated ? 0 : round3(Math.max(qty - stockUsed, 0));
          const extraQty = estimated ? 0 : round3(Math.max(it.extraQty ?? 0, 0));
          const restockTotal = round3(purchaseQty + extraQty);

          if (restockTotal > 0) {
            // 厂家：行内指定优先，否则用商品厂家匹配到的厂家（事务前已兜底建档）
            const supplierId =
              it.supplierId ??
              (product.manufacturer.trim()
                ? supplierByMfr.get(product.manufacturer.trim())
                : undefined);
            if (supplierId == null) {
              throw new Error(`商品 #${product.id} 需现场进货但无法确定厂家`);
            }
            const g = autoGroups.get(supplierId) ?? [];
            g.push({
              productId: it.productId,
              quantity: restockTotal,
              stockExtra: extraQty,
              supplyPrice: round2(it.supplyPrice),
              unitId: product.unitId,
            });
            autoGroups.set(supplierId, g);
          }
          plans.push({
            productId: it.productId,
            qty,
            stockUsed,
            purchaseQty,
            extraQty,
            restockTotal,
            estimated,
            supplyPrice: round2(it.supplyPrice),
            unitId: it.unitId ?? product.unitId,
            remark: it.remark ?? "",
            stockCost: 0,
            purchaseCost: 0,
          });
        }
        const saleOrder = await tx.saleOrder.create({
          data: {
            orderNo: saleOrderNo,
            customerId,
            status: "confirmed",
            starred,
            totalAmount: 0, // 占位，后更新
            operatorId: user.id,
            remark: remark || null,
          },
          select: { id: true },
        });

        // ①-a 先扣「使用现有库存」的部分：成本取入库前的移动加权成本（库存成本不可改）
        for (const p of plans) {
          if (p.stockUsed <= 0) continue;
          const now = await tx.product.findUnique({
            where: { id: p.productId },
            select: { stockQty: true, stockAmount: true, avgCost: true },
          });
          if (!now) throw new Error(`商品 #${p.productId} 不存在`);
          const cur = { qty: Number(now.stockQty), amount: Number(now.stockAmount), avgCost: Number(now.avgCost) };
          if (cur.qty < p.stockUsed) throw new Error(`商品 #${p.productId} 库存不足（${cur.qty} < ${p.stockUsed}）`);
          p.stockCost = round2(p.stockUsed * cur.avgCost);
          const next = applyStockChange(cur, -p.stockUsed, cur.avgCost);
          await tx.product.update({
            where: { id: p.productId },
            data: { stockQty: next.qty, stockAmount: next.amount, avgCost: next.avgCost },
          });
          await tx.stockMovement.create({
            data: {
              productId: p.productId,
              changeQty: -p.stockUsed,
              beforeQty: cur.qty,
              afterQty: next.qty,
              unitCost: cur.avgCost,
              bizType: "sale_out",
              bizOrderNo: saleOrderNo,
              operatorId: user.id,
            },
          });
        }

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
                restockQty: a.stockExtra,
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
            // tx：与补货单同一个事务。以前这里走全局 prisma，事务回滚（如后面库存不足）会留下假审计
            tx,
            after: {
              orderNo: poNo,
              supplierId,
              sourceSaleOrderId: saleOrder.id,
              auto: true,
              items: autoItems.map((a) => ({
                productId: a.productId,
                qty: a.quantity,
                stockExtra: a.stockExtra,
              })),
            },
          });
        }

        // ② 再扣「现场进货」的部分：此时均价已含本次进货（由开单时填写的进价决定）
        for (const p of plans) {
          if (p.purchaseQty <= 0) continue;
          const now = await tx.product.findUnique({
            where: { id: p.productId },
            select: { stockQty: true, stockAmount: true, avgCost: true },
          });
          if (!now) throw new Error(`商品 #${p.productId} 不存在`);
          const cur = { qty: Number(now.stockQty), amount: Number(now.stockAmount), avgCost: Number(now.avgCost) };
          if (cur.qty < p.purchaseQty) throw new Error(`商品 #${p.productId} 库存不足（${cur.qty} < ${p.purchaseQty}）`);
          // 现场进货部分的成本按「开单时填写的进价」计入客户成本（客户为这批货实际支付的价格）；
          // 库存扣减仍走移动加权，保证库存账金额一致。
          p.purchaseCost = round2(p.purchaseQty * p.supplyPrice);
          const next = applyStockChange(cur, -p.purchaseQty, cur.avgCost);
          await tx.product.update({
            where: { id: p.productId },
            data: { stockQty: next.qty, stockAmount: next.amount, avgCost: next.avgCost },
          });
          await tx.stockMovement.create({
            data: {
              productId: p.productId,
              changeQty: -p.purchaseQty,
              beforeQty: cur.qty,
              afterQty: next.qty,
              unitCost: cur.avgCost,
              bizType: "sale_out",
              bizOrderNo: saleOrderNo,
              operatorId: user.id,
            },
          });
        }

        // 成本快照 = 库存部分成本（原移动加权）+ 现场进货部分成本（现场进价），两部分分开计算
        for (let i = 0; i < plans.length; i++) {
          const p = plans[i];
          const costAmount = round2(p.stockCost + p.purchaseCost);
          rowsItem.push({
            productId: p.productId,
            quantity: p.qty,
            unitId: p.unitId,
            unitPrice: round2(items[i].unitPrice),
            costAmount,
            avgCost: p.qty > 0 ? round2(costAmount / p.qty) : 0,
            remark: p.remark,
            stockQtyUsed: p.stockUsed,
            estimated: p.estimated,
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
              unitId: r.unitId,
              unitPrice: r.unitPrice,
              amount: round2(r.quantity * r.unitPrice),
              costAmount: r.costAmount,
              stockQtyUsed: r.stockQtyUsed,
              estimated: r.estimated,
              remark: r.remark || null,
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
