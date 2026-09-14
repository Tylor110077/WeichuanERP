import { z } from "zod";
import { prisma, type TxClient } from "@/lib/prisma";
import { auditIp, writeAudit } from "@/lib/audit";
import { applyStockChange } from "@/lib/stock-cost";
import { runInTransaction } from "@/lib/services/dry-run";
import { createSaleOrder, type CreateSaleOrderInput } from "@/lib/services/orders/sale-create";
import { createPurchaseOrder, type CreatePurchaseOrderInput } from "@/lib/services/orders/purchase-create";
import { fail, ok, type Actor, type CliResult } from "@/lib/cli/types";

/**
 * 单据作废 与 改单（服务层；网页 action 与 CLI 共用）。
 *
 * 口径照抄 voidSaleOrderAction / voidPurchaseOrderAction，改动必须同步改页面：
 * - 售卖单作废：售卖行**跳过估价行**（它从没占过库存）后按当前均价回补；
 *   级联作废由本单生成的自动补货进货单（生成即入库，所以要冲回）
 * - 进货单作废：未入库（pending）直接作废、不碰库存；已入库要先校验**库存没被消耗**
 *   （`stockQty >= 本单数量`），否则拒绝并建议改用进货退货
 * - 业务员无作废权限
 *
 * **已有的两条保护**（本会话补的，见计划 §3.5 / §13.8）：
 * 1. 售卖单**已有确认退货时拒绝作废**——退货已把货补回来一次，作废再按整单补一遍就是多补
 * 2. 估价行在所有库存回补里都跳过
 *
 * **改单**（reopen）：既有实现是"作废原单 + 用原单内容重开一张新单"，但那只是
 * 前端跳转到开单页重新填一遍（两个独立动作，新版与旧版之间没有任何关联字段）。
 * CLI 没有那层 UI，所以这里把它做成**一个服务入口**：先作废、再按原单内容 + 覆盖项
 * 建新单，并返回新旧两个单号。
 *
 * 关于原子性（如实说明）：作废与建单是**两个事务**。原因是建单逻辑本身自成事务
 * （runInTransaction 会自己开事务，Prisma 不支持嵌套）。所以理论上存在
 * "作废成功、建单失败"的中间态——网页上同样存在（作废后跳到开单页，填一半失败）。
 * 缓解办法：**动手作废之前先做一次建单预演**，把"新单能不能建出来"先验证一遍；
 * 真失败时返回值里会明确写出"原单已作废"，不让人误以为一切照旧。
 */

const reopenSchema = z.object({
  type: z.enum(["sale", "purchase"]),
  fromId: z.coerce.number().int().positive("请指定原单 --from-id"),
  reason: z.string().trim().max(200).optional(),
  remark: z.string().trim().max(200).nullable().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  starred: z.boolean().optional(),
  items: z.array(z.record(z.string(), z.unknown())).optional(),
  validateCreate: z.boolean().optional(),
});

const reasonSchema = z.object({ id: z.coerce.number().int().positive("请指定单据 --id"), reason: z.string().trim().min(1, "请填写作废原因").max(200) });

const qty = (n: number) => n.toFixed(3);
const money = (n: number) => n.toFixed(2);

/* ------------------------------------------------------------ 售卖单作废 */

export async function voidSaleOrder(
  actor: Actor,
  rawInput: { id: number; reason: string },
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role === "sales") return fail("FORBIDDEN", "业务员无作废权限");
  const parsed = reasonSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const { id, reason } = parsed.data;

  const order = await prisma.saleOrder.findUnique({
    where: { id },
    include: {
      items: true,
      autoRestockOrders: { include: { items: true } },
      returns: { where: { status: "confirmed" }, select: { orderNo: true } },
    },
  });
  if (!order) return fail("NOT_FOUND", `售卖单不存在：#${id}`);
  if (order.status === "voided") return fail("RULE", `单据 ${order.orderNo} 已作废`);

  // 已有确认退货 → 拒绝（否则库存会被重复补回）
  if (order.returns.length > 0) {
    const nos = order.returns.map((r) => r.orderNo).join("、");
    return fail(
      "RULE",
      `本单已有 ${order.returns.length} 张退货单（${nos}），不能直接作废——否则库存会被重复补回。请先作废那些退货单，或改用「改单」。`
    );
  }

  const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
    const lines = [];
    // ① 售卖行库存回补（跳过估价行）
    for (const item of order.items) {
      if (item.estimated) {
        lines.push({ 商品行: item.id, 处理: "估价行，跳过库存" });
        continue;
      }
      const next = await reverseStock(tx, item.productId, Number(item.quantity), order.orderNo, actor.userId, +1, `+${qty(Number(item.quantity))}`);
      lines.push({ 商品行: item.id, 处理: "库存回补", 变化: next });
    }
    // ② 级联作废自动补货单
    for (const po of order.autoRestockOrders) {
      for (const item of po.items) {
        const before = await getStock(tx, item.productId);
        if (before.qty < Number(item.quantity)) {
          throw new Error(`商品 #${item.productId} 库存不足，无法级联冲回补货单 ${po.orderNo}`);
        }
        const next = await reverseStock(tx, item.productId, Number(item.quantity), po.orderNo, actor.userId, -1, `-${qty(Number(item.quantity))}`);
        lines.push({ 自动补货单: po.orderNo, 处理: "级联冲回", 变化: next });
      }
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: "voided", voidedBy: actor.userId, voidedAt: new Date(), voidReason: `随售卖单作废：${order.orderNo}` },
      });
      await writeAudit({
        userId: actor.userId,
        action: "void",
        entityType: "purchase_order",
        entityId: po.id,
        tx,
        ip: auditIp(actor),
        before: { orderNo: po.orderNo, status: po.status },
        after: { orderNo: po.orderNo, status: "voided", voidReason: `随售卖单作废：${order.orderNo}` },
      });
    }
    await tx.saleOrder.update({
      where: { id },
      data: { status: "voided", voidedBy: actor.userId, voidedAt: new Date(), voidReason: reason },
    });
    await writeAudit({
      userId: actor.userId,
      action: "void",
      entityType: "sale_order",
      entityId: id,
      tx,
      ip: auditIp(actor),
      before: { orderNo: order.orderNo, status: order.status },
      after: {
        orderNo: order.orderNo,
        status: "voided",
        voidReason: reason,
        cascaded: order.autoRestockOrders.length,
        source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web",
        runId: actor.runId ?? null,
      },
    });
    return { 单据: order.orderNo, 操作: "作废", 行: lines, 级联作废自动补货单: order.autoRestockOrders.map((p) => p.orderNo) };
  });
  return ok({ committed, dryRun: !committed, ...(committed ? {} : { 说明: "这是预演，什么都没写。确认后加 --yes" }), plan });
}

/* ------------------------------------------------------------ 进货单作废 */

export async function voidPurchaseOrder(
  actor: Actor,
  rawInput: { id: number; reason: string },
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  if (actor.role === "sales") return fail("FORBIDDEN", "业务员无作废权限");
  const parsed = reasonSchema.safeParse(rawInput);
  if (!parsed.success) return fail("INVALID", parsed.error.issues[0]?.message ?? "参数不正确");
  const { id, reason } = parsed.data;

  const order = await prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
  if (!order) return fail("NOT_FOUND", `进货单不存在：#${id}`);
  if (order.status === "voided") return fail("RULE", `单据 ${order.orderNo} 已作废`);

  // 已入库的单：先校验库存没被消耗（否则应改用进货退货）
  if (order.status === "received") {
    for (const item of order.items) {
      const p = await prisma.product.findUnique({ where: { id: item.productId }, select: { stockQty: true } });
      const available = Number(p?.stockQty ?? 0);
      if (available < Number(item.quantity)) {
        return fail(
          "RULE",
          `商品 #${item.productId} 当前库存 ${qty(available)} < 本单数量 ${qty(Number(item.quantity))}，库存已被消耗，无法直接作废；请改用【进货退货】`
        );
      }
    }
  }

  const { committed, plan } = await runInTransaction(opts.dryRun, async (tx) => {
    const lines = [];
    if (order.status === "received") {
      for (const item of order.items) {
        const next = await reverseStock(tx, item.productId, Number(item.quantity), order.orderNo, actor.userId, -1, `-${qty(Number(item.quantity))}`);
        lines.push({ 商品行: item.id, 处理: "库存冲回", 变化: next });
      }
    }
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: "voided", voidedBy: actor.userId, voidedAt: new Date(), voidReason: reason },
    });
    await writeAudit({
      userId: actor.userId,
      action: "void",
      entityType: "purchase_order",
      entityId: id,
      tx,
      ip: auditIp(actor),
      before: { orderNo: order.orderNo, status: order.status },
      after: {
        orderNo: order.orderNo,
        status: "voided",
        voidReason: reason,
        stockReversed: order.status === "received",
        source: actor.kind === "agent" ? `cli:${actor.tokenName ?? ""}` : "web",
        runId: actor.runId ?? null,
      },
    });
    return {
      单据: order.orderNo,
      操作: "作废",
      行: lines,
      说明: order.status === "received" ? "已入库，库存已冲回" : "未入库，无库存影响",
    };
  });
  return ok({ committed, dryRun: !committed, ...(committed ? {} : { 说明: "这是预演，什么都没写。确认后加 --yes" }), plan });
}

/* ---------------------------------------------------------------- 改单 */

/**
 * 改单 = 作废原单 + 用原单内容重开一张新单。
 *
 * `overrides` 可以覆盖原单的客户/厂家/备注/星标；行也可以整体替换（`items` 传了就用它，
 * 否则照抄原单的行——原单行会带上当时的售价/进价，从而"重开成一张一模一样的单"）。
 * 一行不改就重开，等于"作废 + 重开"（用于修正开错客户之类的场景）。
 */
export async function reopenOrder(
  actor: Actor,
  rawInput: {
    type: "sale" | "purchase";
    fromId: number;
    reason?: string;
    remark?: string | null;
    customerId?: number;
    supplierId?: number;
    starred?: boolean;
    items?: unknown;
    /** 预演时是否连带校验新单能建出来（默认 true） */
    validateCreate?: boolean;
  },
  opts: { dryRun: boolean }
): Promise<CliResult<Record<string, unknown>>> {
  // 入参先过 zod：否则一个字符串 id 会被直接送进 Prisma，抛的是内部错误而不是可读的 INVALID
  const parsedInput = reopenSchema.safeParse(rawInput);
  if (!parsedInput.success) return fail("INVALID", parsedInput.error.issues[0]?.message ?? "参数不正确");
  const { type, fromId } = parsedInput.data;
  const reason = (parsedInput.data.reason ?? "改单").trim().slice(0, 200);
  const raw = parsedInput.data;

  if (type === "sale") {
    const order = await prisma.saleOrder.findUnique({ where: { id: fromId }, include: { items: true } });
    if (!order) return fail("NOT_FOUND", `售卖单不存在：#${fromId}`);
    if (order.status === "voided") return fail("RULE", `单据 ${order.orderNo} 已作废，无法改单`);

    // 原单内容 → 新单输入（照抄，除非给了覆盖项）
    // 行的形状交给下游 createSaleOrder 的 zod 校验；这里只负责"用传入的行还是照抄原单"
    const items = (
      Array.isArray(raw.items) && raw.items.length > 0
        ? raw.items
        : order.items.map((it) => ({
            productId: it.productId,
            quantity: Number(it.quantity),
            unitPrice: Number(it.unitPrice),
            // 原单行没有存"现场进货价"：按成本快照均价回填（改单时通常要重新确认进价）
            supplyPrice: Number(it.quantity) > 0 ? Number(it.costAmount) / Number(it.quantity) : 0,
            unitId: it.unitId,
            remark: it.remark ?? "",
            estimated: it.estimated,
          }))
    ) as unknown as CreateSaleOrderInput["items"];
    const input: CreateSaleOrderInput = {
      customerId: raw.customerId ?? order.customerId,
      remark: raw.remark ?? order.remark ?? "",
      starred: raw.starred ?? order.starred,
      items,
    };
    return reopenTwice(actor, opts, {
      type,
      fromOrderNo: order.orderNo,
      voidFn: (a, o) => voidSaleOrder(a, { id: fromId, reason }, o),
      createFn: (a, o) => createSaleOrder(a, input, o),
      newSummary: { customerId: input.customerId, lines: items.length },
    });
  }

  const order = await prisma.purchaseOrder.findUnique({ where: { id: fromId }, include: { items: true } });
  if (!order) return fail("NOT_FOUND", `进货单不存在：#${fromId}`);
  if (order.status === "voided") return fail("RULE", `单据 ${order.orderNo} 已作废，无法改单`);

  const items = (
    Array.isArray(raw.items) && raw.items.length > 0
      ? raw.items
      : order.items.map((it) => ({
          productId: it.productId,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          remark: it.remark ?? "",
        }))
  ) as unknown as CreatePurchaseOrderInput["items"];
  const input: CreatePurchaseOrderInput = {
    supplierId: raw.supplierId ?? order.supplierId,
    remark: raw.remark ?? order.remark ?? "",
    starred: raw.starred ?? order.starred,
    items,
  };
  return reopenTwice(actor, opts, {
    type,
    fromOrderNo: order.orderNo,
    voidFn: (a, o) => voidPurchaseOrder(a, { id: fromId, reason }, o),
    createFn: (a, o) => createPurchaseOrder(a, input, o),
    newSummary: { supplierId: input.supplierId, lines: items.length },
  });
}

async function reopenTwice(
  actor: Actor,
  opts: { dryRun: boolean },
  args: {
    type: "sale" | "purchase";
    fromOrderNo: string;
    voidFn: (a: Actor, o: { dryRun: boolean }) => Promise<CliResult<Record<string, unknown>>>;
    createFn: (a: Actor, o: { dryRun: boolean }) => Promise<CliResult<Record<string, unknown>>>;
    newSummary: Record<string, unknown>;
  }
): Promise<CliResult<Record<string, unknown>>> {
  const { type, fromOrderNo, voidFn, createFn, newSummary } = args;

  if (opts.dryRun) {
    // 预演：作废按预演跑（不落库），再用同一套逻辑试建新单（也预演），
    // 这样"新单能不能建出来"在动手之前就能看到
    const voidPlan = await voidFn(actor, { dryRun: true });
    if (!voidPlan.ok) return voidPlan;
    const createPlan = await createFn(actor, { dryRun: true });
    return ok({
      committed: false,
      dryRun: true,
      plan: {
        操作: "改单（预演：作废原单 + 重开新单，两步都不会落库）",
        原单: fromOrderNo,
        将作废: voidPlan.data.plan,
        将新建: createPlan.ok ? createPlan.data.plan : `❌ 新单建不出来：${createPlan.error.code} ${createPlan.error.message}`,
        新单输入摘要: newSummary,
      },
    });
  }

  // 真落库：先作废、再建新单。两步各自成事务（Prisma 不支持嵌套事务）。
  const voided = await voidFn(actor, { dryRun: false });
  if (!voided.ok) return voided;
  const created = await createFn(actor, { dryRun: false });
  if (!created.ok) {
    return fail(
      created.error.code,
      `原单 ${fromOrderNo} **已作废**，但新单创建失败：${created.error.message}。请手动重开一张（原单内容已作废，不能再改）。`
    );
  }
  const newNo = (created.data.plan as { 单据: { orderNo: string } }).单据.orderNo;
  return ok({
    committed: true,
    dryRun: false,
    plan: {
      操作: "改单完成",
      类型: type === "sale" ? "售卖单" : "进货单",
      原单: `${fromOrderNo}（已作废）`,
      新单: newNo,
      新单内容: created.data.plan,
    },
  });
}

/* ---------------------------------------------------------------- 工具 */

async function getStock(tx: TxClient, productId: number) {
  const p = await tx.product.findUnique({ where: { id: productId }, select: { stockQty: true, stockAmount: true, avgCost: true } });
  if (!p) throw new Error(`商品 #${productId} 不存在`);
  return { qty: Number(p.stockQty), amount: Number(p.stockAmount), avgCost: Number(p.avgCost) };
}

/** 按当前移动加权均价做一次库存变动 + 流水。sign=+1 入库、-1 出库 */
async function reverseStock(
  tx: TxClient,
  productId: number,
  quantity: number,
  bizOrderNo: string,
  operatorId: number,
  sign: 1 | -1,
  label: string
): Promise<string> {
  const before = await getStock(tx, productId);
  const next = applyStockChange(before, sign * quantity, before.avgCost);
  await tx.product.update({
    where: { id: productId },
    data: { stockQty: next.qty, stockAmount: next.amount, avgCost: next.avgCost },
  });
  await tx.stockMovement.create({
    data: {
      productId,
      changeQty: sign * quantity,
      beforeQty: before.qty,
      afterQty: next.qty,
      unitCost: before.avgCost,
      bizType: "void_reverse",
      bizOrderNo,
      operatorId,
    },
  });
  return `${label}：${qty(before.qty)} → ${qty(next.qty)}（均价 ${before.avgCost.toFixed(4)}）`;
}

export { money };
