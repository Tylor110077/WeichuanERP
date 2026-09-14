import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditIp, auditProvenance, writeAudit } from "@/lib/audit";
import { applyStockChange } from "@/lib/stock-cost";
import { buildOrderNo, nextOrderSeq, ORDER_NO_PREFIXES } from "@/lib/order-no";
import { optionalNumber, requiredNumber } from "@/lib/form-number";
import { runInTransaction } from "@/lib/services/dry-run";
import { provenanceFor } from "@/lib/services/provenance";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 开售卖单（服务层；网页 action 与 CLI 共用同一份逻辑）。
 *
 * **这份逻辑是整套系统里最要命的一段**，所以逐行对照
 * src/app/(main)/sale-orders/actions.ts 搬过来，语义一字不改：
 *
 * 1. 逐行决定「用库存 / 现场进货 / 多补」：用库存量 = min(库存, 需求)，其余现场进货
 * 2. ①-a 先扣「使用现有库存」的部分，成本取**扣减前**的移动加权均价（不可改）
 * 3. ①-b 现场进货：**按厂家分组自动生成进货单并当场入库**（status=received），
 *    入库价 = 开单时填的进价 → 这一步改写了移动加权均价
 * 4. ② 再扣「现场进货」的部分：库存扣减走**移动加权**（保证库存账金额一致），
 *    但计入客户成本的是**开单时填的进价**（客户为这批货实际付的价格）
 * 5. 成本快照 = 库存部分成本 + 现场进货部分成本，写成 sale_order_items.cost_amount
 * 6. 估价行：全程不占库存、不补货、成本记 0（等补单时回写）
 *
 * 刻意保留的既有行为（不是遗漏）：
 * - 现场进货部分**先入后出**：入库价与出库用的均价不同，这一步会留下库存金额扰动，
 *   这是既有实现（评审决议 v0.3：自动补货单生成即入库）的固有代价
 * - 状态校验在事务外读（并发下可能双开补单），与网页一致；改进留给后续
 *
 * 与网页版的一处**有意差别**：审计写在事务内（网页版在事务之后）。
 * 依据 A5 的裁决：同一套库，审计写不进去说明事务本身已经坏了，
 * "货和钱都动了却查不到谁干的"比"这次请求失败"更糟。
 */

const itemSchema = z.object({
  productId: z.coerce.number().int().positive("请选择商品"),
  estimated: z.boolean().optional(),
  unitId: z.coerce.number().int().positive().optional(),
  quantity: requiredNumber({ invalid: "请填写数量", min: 0.001, minMessage: "数量必须大于 0", max: 9_999_999.999, maxMessage: "数量过大" }),
  unitPrice: requiredNumber({ invalid: "请填写售价", min: 0, max: 9_999_999_999.99, maxMessage: "售价格式不正确" }),
  supplyPrice: requiredNumber({ invalid: "请填写进价", min: 0, max: 9_999_999_999.99, maxMessage: "进价格式不正确" }),
  supplierId: z.coerce.number().int().positive().optional().nullable(),
  extraQty: optionalNumber({ invalid: "多补必须是数字", min: 0, minMessage: "多补不能为负", max: 9_999_999.999, maxMessage: "多补过大" }).default(0),
  remark: z.string().trim().max(200).optional().default(""),
  stockUsed: optionalNumber({ invalid: "用库存必须是数字", min: 0, minMessage: "用库存不能为负", max: 9_999_999.999, maxMessage: "用库存过大" }),
});

const createSchema = z.object({
  customerId: z.coerce.number().int().positive("请选择客户"),
  remark: z.string().trim().max(200).optional().default(""),
  starred: z.boolean().optional(),
  items: z.array(itemSchema).min(1, "请至少添加一行商品"),
});

export type CreateSaleOrderInput = z.input<typeof createSchema>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** 现场进货用的行计划 */
interface LinePlan {
  productId: number;
  qty: number;
  stockUsed: number;
  purchaseQty: number;
  extraQty: number;
  restockTotal: number;
  estimated: boolean;
  supplyPrice: number;
  unitId: number;
  remark: string;
  stockCost: number;
  purchaseCost: number;
}
interface AutoItem {
  productId: number;
  quantity: number;
  stockExtra: number;
  supplyPrice: number;
  unitId: number;
}

export async function createSaleOrder(
  actor: Actor,
  rawInput: CreateSaleOrderInput,
  opts: { dryRun: boolean; revisionOf?: number; version?: number }
): Promise<CliResult<Record<string, unknown>>> {
  // 与网页的 requireSaleWrite 同一句话：老板/财务只能看，不能开单。
  // 这道判定必须在服务层，否则 boss 的令牌可以走 CLI 开单（网页是拦住的）。
  if (actor.role === "boss") return fail("FORBIDDEN", "老板/财务无销售开单权限");

  const parsed = createSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "输入有误");
  const { customerId, remark, items } = parsed.data;
  const starred = parsed.data.starred ?? false;

  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, status: true } });
  if (!customer || customer.status !== 1) return fail("RULE", "客户不存在或已停用");

  const productIds = [...new Set(items.map((it) => it.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, status: true, unitId: true, manufacturer: true, stockQty: true, stockAmount: true, avgCost: true, name: true, code: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));
  for (const p of products) {
    if (p.status !== 1) return fail("RULE", `商品 #${p.id} 已停用，无法开单`);
  }

  // 归属厂家：缺货行没指定厂家时用商品档案的厂家；档案里的厂家名没有对应厂家档案就按名建档
  const supplierIds = new Set<number>();
  const mfrNames = new Set<string>();
  for (const it of items) {
    const product = productMap.get(it.productId);
    if (!product) return fail("INVALID", `商品 #${it.productId} 不存在`);
    // 估价行不占库存、不补货（下方计划逻辑已把它的用量与补货量全部归零），因此也不需要补货厂家
    if (it.estimated) continue;
    const shortfall = Math.max(Number(product.stockQty) < it.quantity ? it.quantity - Number(product.stockQty) : 0, 0);
    if (shortfall > 0) {
      if (it.supplierId) supplierIds.add(it.supplierId);
      else if (product.manufacturer.trim()) mfrNames.add(product.manufacturer.trim());
      else {
        return fail("INVALID", `商品 #${product.id}（${product.name}）缺货且无厂家，请指定补货厂家（--supplier-id）或先补商品档案的厂家`);
      }
    }
  }
  if (supplierIds.size > 0) {
    const rows = await prisma.supplier.findMany({ where: { id: { in: [...supplierIds] }, status: 1 }, select: { id: true } });
    if (rows.length !== supplierIds.size) return fail("RULE", "存在已停用的补货厂家");
  }

  try {
    const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
      // ① 按名补齐厂家档案（开单时现场新建的厂家，走与网页同一套：按名字查/建）
      const supplierByMfr = new Map<string, number>();
      if (mfrNames.size > 0) {
        const existing = await tx.supplier.findMany({ where: { name: { in: [...mfrNames] } }, select: { id: true, name: true } });
        for (const sup of existing) supplierByMfr.set(sup.name, sup.id);
        for (const name of mfrNames) {
          if (!supplierByMfr.has(name)) {
            const created = await tx.supplier.create({ data: { name }, select: { id: true, name: true } });
            supplierByMfr.set(name, created.id);
            await writeAudit({
              userId: actor.userId,
              action: "create",
              entityType: "supplier",
              entityId: created.id,
              tx,
              ip: auditIp(actor),
        ...auditProvenance(actor),
              after: { name: created.name, autoFromManufacturer: true, source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web" },
            });
          }
        }
      }

      const saleOrderNo = buildOrderNo(
        ORDER_NO_PREFIXES.SO,
        await nextOrderSeq(ORDER_NO_PREFIXES.SO, (like) =>
          tx.saleOrder.findMany({ where: { orderNo: { startsWith: like } }, select: { orderNo: true } })
        )
      );

      // ② 逐行计划：用多少库存、现场进多少
      const autoGroups = new Map<number, AutoItem[]>();
      const plans: LinePlan[] = [];
      for (const it of items) {
        const product = productMap.get(it.productId)!;
        const qty = round3(it.quantity);
        const stock = Math.max(Number(product.stockQty), 0);
        const estimated = !!it.estimated;
        const requested = it.stockUsed == null ? Math.min(stock, qty) : Math.max(Number(it.stockUsed), 0);
        const stockUsed = estimated ? 0 : round3(Math.min(requested, stock, qty));
        const purchaseQty = estimated ? 0 : round3(Math.max(qty - stockUsed, 0));
        const extraQty = estimated ? 0 : round3(Math.max(it.extraQty ?? 0, 0));
        const restockTotal = round3(purchaseQty + extraQty);

        if (restockTotal > 0) {
          const supplierId =
            it.supplierId ?? (product.manufacturer.trim() ? supplierByMfr.get(product.manufacturer.trim()) : undefined);
          if (supplierId == null) throw new Error(`商品 #${product.id} 需现场进货但无法确定厂家`);
          const g = autoGroups.get(supplierId) ?? [];
          g.push({ productId: it.productId, quantity: restockTotal, stockExtra: extraQty, supplyPrice: round2(it.supplyPrice), unitId: product.unitId });
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
          totalAmount: 0,
          operatorId: actor.userId,
          remark: remark || null,
          // 来源与审核状态由服务层统一写入（Agent 必须诚实标注自己，CLI 绕不过去）
          ...provenanceFor(actor, { revisionOf: opts.revisionOf, version: opts.version }),
        },
        select: { id: true },
      });

      const deducted: { productId: number; qty: number; bizType: string; bizOrderNo: string }[] = [];

      // ③ 先扣「使用现有库存」的部分：成本取扣减前的移动加权均价
      for (const p of plans) {
        if (p.stockUsed <= 0) continue;
        const now = await tx.product.findUnique({ where: { id: p.productId }, select: { stockQty: true, stockAmount: true, avgCost: true } });
        if (!now) throw new Error(`商品 #${p.productId} 不存在`);
        const cur = { qty: Number(now.stockQty), amount: Number(now.stockAmount), avgCost: Number(now.avgCost) };
        if (cur.qty < p.stockUsed) throw new Error(`商品 #${p.productId} 库存不足（${cur.qty} < ${p.stockUsed}）`);
        p.stockCost = round2(p.stockUsed * cur.avgCost);
        const next = applyStockChange(cur, -p.stockUsed, cur.avgCost);
        await tx.product.update({ where: { id: p.productId }, data: { stockQty: next.qty, stockAmount: next.amount, avgCost: next.avgCost } });
        await tx.stockMovement.create({
          data: { productId: p.productId, changeQty: -p.stockUsed, beforeQty: cur.qty, afterQty: next.qty, unitCost: cur.avgCost, bizType: "sale_out", bizOrderNo: saleOrderNo, operatorId: actor.userId },
        });
        deducted.push({ productId: p.productId, qty: -p.stockUsed, bizType: "sale_out", bizOrderNo: saleOrderNo });
      }

      // ④ 现场进货：按厂家生成进货单并**当场入库**（生成即入库，评审决议 v0.3）
      const autoPurchaseOrders: { id: number; orderNo: string; supplierId: number; totalAmount: number }[] = [];
      for (const [supplierId, autoItems] of autoGroups) {
        const poNo = buildOrderNo(
          ORDER_NO_PREFIXES.PO,
          await nextOrderSeq(ORDER_NO_PREFIXES.PO, (like) =>
            tx.purchaseOrder.findMany({ where: { orderNo: { startsWith: like } }, select: { orderNo: true } })
          )
        );
        const poTotal = round2(autoItems.reduce((s, a) => s + a.quantity * a.supplyPrice, 0));
        const po = await tx.purchaseOrder.create({
          data: {
            orderNo: poNo,
            supplierId,
            status: "received",
            sourceType: "auto",
            sourceSaleOrderId: saleOrder.id,
            totalAmount: poTotal,
            receivedAt: new Date(),
            operatorId: actor.userId,
          },
          select: { id: true },
        });
        for (const a of autoItems) {
          const product = await tx.product.findUnique({ where: { id: a.productId }, select: { stockQty: true, stockAmount: true, avgCost: true } });
          if (!product) throw new Error(`商品 #${a.productId} 不存在`);
          const before = { qty: Number(product.stockQty), amount: Number(product.stockAmount), avgCost: Number(product.avgCost) };
          const next = applyStockChange(before, a.quantity, a.supplyPrice);
          await tx.product.update({ where: { id: a.productId }, data: { stockQty: next.qty, stockAmount: next.amount, avgCost: next.avgCost } });
          await tx.stockMovement.create({
            data: { productId: a.productId, changeQty: a.quantity, beforeQty: before.qty, afterQty: next.qty, unitCost: a.supplyPrice, bizType: "purchase_in", bizOrderNo: poNo, operatorId: actor.userId },
          });
          await tx.purchaseOrderItem.create({
            data: { purchaseOrderId: po.id, productId: a.productId, quantity: a.quantity, restockQty: a.stockExtra, unitId: a.unitId, unitPrice: a.supplyPrice, amount: round2(a.quantity * a.supplyPrice) },
          });
        }
        await writeAudit({
          userId: actor.userId,
          action: "create",
          entityType: "purchase_order",
          entityId: po.id,
          tx,
          ip: auditIp(actor),
        ...auditProvenance(actor),
          after: {
            orderNo: poNo,
            supplierId,
            sourceSaleOrderId: saleOrder.id,
            auto: true,
            source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web",
            runId: actor.runId ?? null,
          },
        });
        autoPurchaseOrders.push({ id: po.id, orderNo: poNo, supplierId, totalAmount: poTotal });
      }

      // ⑤ 再扣「现场进货」的部分：库存扣减走移动加权，计入客户成本的是开单时填的进价
      for (const p of plans) {
        if (p.purchaseQty <= 0) continue;
        const now = await tx.product.findUnique({ where: { id: p.productId }, select: { stockQty: true, stockAmount: true, avgCost: true } });
        if (!now) throw new Error(`商品 #${p.productId} 不存在`);
        const cur = { qty: Number(now.stockQty), amount: Number(now.stockAmount), avgCost: Number(now.avgCost) };
        if (cur.qty < p.purchaseQty) throw new Error(`商品 #${p.productId} 库存不足（${cur.qty} < ${p.purchaseQty}）`);
        p.purchaseCost = round2(p.purchaseQty * p.supplyPrice);
        const next = applyStockChange(cur, -p.purchaseQty, cur.avgCost);
        await tx.product.update({ where: { id: p.productId }, data: { stockQty: next.qty, stockAmount: next.amount, avgCost: next.avgCost } });
        await tx.stockMovement.create({
          data: { productId: p.productId, changeQty: -p.purchaseQty, beforeQty: cur.qty, afterQty: next.qty, unitCost: cur.avgCost, bizType: "sale_out", bizOrderNo: saleOrderNo, operatorId: actor.userId },
        });
        deducted.push({ productId: p.productId, qty: -p.purchaseQty, bizType: "sale_out", bizOrderNo: saleOrderNo });
      }

      // ⑥ 成本快照与单据行
      const rowsItem = plans.map((p, i) => {
        const costAmount = round2(p.stockCost + p.purchaseCost);
        return {
          productId: p.productId,
          quantity: p.qty,
          unitId: p.unitId,
          unitPrice: round2(items[i].unitPrice),
          costAmount,
          remark: p.remark,
          stockQtyUsed: p.stockUsed,
          estimated: p.estimated,
        };
      });
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

      await writeAudit({
        userId: actor.userId,
        action: "create",
        entityType: "sale_order",
        entityId: saleOrder.id,
        tx,
        ip: auditIp(actor),
        ...auditProvenance(actor),
        after: {
          orderNo: saleOrderNo,
          customerId,
          totalAmount,
          source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web",
          runId: actor.runId ?? null,
        },
      });

      return {
        单据: { id: saleOrder.id, orderNo: saleOrderNo },
        客户: customer.name,
        金额合计: totalAmount.toFixed(2),
        行: rowsItem.map((r, i) => ({
          商品: `${productMap.get(r.productId)!.code} ${productMap.get(r.productId)!.name}`,
          数量: r.quantity.toFixed(3),
          售价: r.unitPrice.toFixed(2),
          用库存: r.stockQtyUsed.toFixed(3),
          现场进货: plans[i].purchaseQty.toFixed(3),
          多补: plans[i].extraQty.toFixed(3),
          成本快照: r.costAmount.toFixed(2),
          估价待补: r.estimated,
        })),
        自动补货进货单: autoPurchaseOrders.map((p) => ({ id: p.id, orderNo: p.orderNo, 金额: p.totalAmount.toFixed(2) })),
        库存流水: deducted.map((d) => ({ productId: d.productId, 变动: d.qty.toFixed(3), 类型: d.bizType, 单号: d.bizOrderNo })),
      };
    });

    return ok({ committed, dryRun: !committed, ...(committed ? {} : { 说明: "这是预演，什么都没写。确认后加 --yes" }), plan });
  } catch (e) {
    console.error("[sale-order.create] 失败:", e);
    return fail("RULE", e instanceof Error ? e.message : "开单失败");
  }
}
