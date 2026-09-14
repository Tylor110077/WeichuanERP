import { fail, ok, SCOPES, type Actor, type CliResult } from "./types";
import { listSaleOrders, type ListSaleOrdersInput } from "@/lib/services/sale-orders";
import { listPurchaseOrders, type ListPurchaseOrdersInput } from "@/lib/services/purchase-orders";
import { listInventory, type ListInventoryInput } from "@/lib/services/inventory";
import { listOutstanding } from "@/lib/services/outstanding";
import { listPayments, type ListPaymentsInput } from "@/lib/services/payments";
import { listStockMovements, type ListStockMovementsInput } from "@/lib/services/stock-movements";
import { listAuditLogs, runReport, type ListAuditLogsInput, type ReportInput } from "@/lib/services/audit-and-reports";
import { createProduct, setProductStatus, type CreateProductInput } from "@/lib/services/master/product";
import { saveCustomer, saveSupplier, type SaveCustomerInput, type SaveSupplierInput } from "@/lib/services/master/partner";
import { createPayment, voidPayment, type CreatePaymentInput } from "@/lib/services/payments-write";
import { createSaleOrder, type CreateSaleOrderInput } from "@/lib/services/orders/sale-create";
import { createPurchaseOrder, type CreatePurchaseOrderInput } from "@/lib/services/orders/purchase-create";
import { saveCategory, saveUnit, setTaxonomyStatus, type SaveTaxonomyInput } from "@/lib/services/master/taxonomy";
import {
  listCategories,
  listCustomers,
  listProducts,
  listSuppliers,
  listUnits,
  type ListCustomersInput,
  type ListProductsInput,
  type ListSuppliersInput,
} from "@/lib/services/master-data";

/**
 * 命令注册表：**唯一**声明"这个 op 需要什么权限"的地方。
 *
 * 为什么集中在这里：现状没有 middleware.ts，鉴权散落在每个 page 与每个 action 里
 * （同类问题在网页侧已经反复出现）。命令面会长到几十条，权限一旦分散，
 * 新增命令漏挂鉴权是迟早的事；集中成一张表，漏挂会立刻显出来。
 */
export interface OpDef {
  /** 需要的 scope；null = 登录即可 */
  requiredScope: string | null;
  /** 人类专属：Agent 令牌一律拒绝（审核类操作走这里，见 §5.6 的"不能自审自批"） */
  humanOnly?: boolean;
  /** 写操作：CLI 默认 dry-run，必须 --yes 才落库（Phase 3 起大量使用） */
  write?: boolean;
  /** 一句话说明，供 --help / 未知命令提示使用 */
  summary: string;
  /** 第三个参数只对写操作有意义：dryRun 由端点层按 `commit` 决定（默认 true） */
  handler: (
    actor: Actor,
    input: Record<string, unknown>,
    opts: { dryRun: boolean }
  ) => Promise<CliResult<unknown>>;
}

export const OPS: Record<string, OpDef> = {
  /**
   * 最小闭环：证明 CLI 拿到了合法身份。
   * 返回的身份信息就是后续所有命令的 actor，所以它同时也是"令牌配错了"的排查入口。
   */
  "auth.whoami": {
    requiredScope: null,
    summary: "显示当前令牌对应的身份与权限",
    handler: async (actor) => ok({ actor }),
  },

  /** 仅供自检：验证权限判定真的在工作（Agent 令牌调用应得 403） */
  "auth.check-review": {
    requiredScope: null,
    humanOnly: true,
    summary: "自检用：人类专属操作，Agent 令牌调用必被拒绝",
    handler: async (actor) =>
      actor.kind === "human" ? ok({ allowed: true }) : fail("FORBIDDEN", "Agent 令牌无权审核"),
  },

  /** 售卖单列表：与网页列表页同一套查询与口径（抽在 lib/services/sale-orders.ts） */
  "query.orders": {
    requiredScope: SCOPES.read,
    summary: "查售卖单列表（默认本月 1 日至今；与网页列表同口径）",
    handler: async (actor, input) => listSaleOrders(actor, input as ListSaleOrdersInput),
  },

  /** 进货单列表：同上 */
  "query.purchase-orders": {
    requiredScope: SCOPES.read,
    summary: "查进货单列表（默认本月 1 日至今；未结清只算 pending/received）",
    handler: async (actor, input) => listPurchaseOrders(actor, input as ListPurchaseOrdersInput),
  },

  /** 库存：预警谓词与库存页共用同一段 SQL（页面那两个 bug 也由此修掉） */
  "query.inventory": {
    requiredScope: SCOPES.read,
    summary: "查库存（--warn-only 只看跌破预警线的；含全局预警数）",
    handler: async (actor, input) => listInventory(actor, input as ListInventoryInput),
  },

  /* 主数据：开单前把「名字」换成「id」用 */
  "query.products": {
    requiredScope: SCOPES.read,
    summary: "查商品档案（编码/名称/厂家/分类/参考价/库存）",
    handler: async (actor, input) => listProducts(actor, input as ListProductsInput),
  },
  "query.customers": {
    requiredScope: SCOPES.read,
    summary: "查客户（名称/电话/分组/标签）",
    handler: async (actor, input) => listCustomers(actor, input as ListCustomersInput),
  },
  "query.suppliers": {
    requiredScope: SCOPES.read,
    summary: "查厂家（含该厂家名下商品数）",
    handler: async (actor, input) => listSuppliers(actor, input as ListSuppliersInput),
  },
  "query.units": {
    requiredScope: SCOPES.read,
    summary: "查单位（开单要填 unitId）",
    handler: listUnits,
  },
  "query.categories": {
    requiredScope: SCOPES.read,
    summary: "查商品分类（补单/建档要填 categoryId）",
    handler: listCategories,
  },

  /**
   * 应收 / 应付。**两个数不要混用**（口径裁决见 §13.8 #1）：
   * outstandingTotalInRange 是区间合计（页面口径），outstandingTotalAllTime 是当前存量（工作台口径）。
   */
  "query.receivables": {
    requiredScope: SCOPES.read,
    summary: "查应收（两个合计口径都在返回里；未结清谓词已下推 SQL）",
    handler: async (actor, input) => listOutstanding(actor, { ...input, direction: "receivable" }),
  },
  "query.payables": {
    requiredScope: SCOPES.read,
    summary: "查应付（同应收，方向相反）",
    handler: async (actor, input) => listOutstanding(actor, { ...input, direction: "payable" }),
  },

  /** 财务流水：默认只看已登记（作废不算数），合计不分收付 */
  "query.payments": {
    requiredScope: SCOPES.read,
    summary: "查收付款流水（默认只看已登记；合计不分收付）",
    handler: async (actor, input) => listPayments(actor, input as ListPaymentsInput),
  },

  /** 库存流水：变动前后的数量与当次单价都在里面 */
  "query.movements": {
    requiredScope: SCOPES.read,
    summary: "查库存流水（进货入库/销售出库/退货/作废冲回）",
    handler: async (actor, input) => listStockMovements(actor, input as ListStockMovementsInput),
  },

  /** 报表：复用 lib/reports.ts，页面 / Excel 导出 / CLI 三处同一份口径 */
  "query.report": {
    requiredScope: SCOPES.read,
    summary: "跑一张报表（汇总里同时给毛额与净额，并标注估价待补行）",
    handler: async (actor, input) => runReport(actor, input as ReportInput),
  },

  /** 审计日志：仅管理员，可按实体/用户/动作筛 */
  "query.audit-logs": {
    requiredScope: SCOPES.read,
    summary: "查审计日志（仅管理员；可按实体/用户/动作筛）",
    handler: async (actor, input) => listAuditLogs(actor, input as ListAuditLogsInput),
  },

  /* ── 主数据写操作（Phase 3 第一片）──
     写操作一律声明 write: true：端点层据此把"没带 commit"的调用变成预演。 */

  "master.product.create": {
    requiredScope: SCOPES.writeMaster,
    write: true,
    summary: "新建商品（默认预演，--yes 才落库）",
    handler: async (actor, input, opts) => createProduct(actor, input as CreateProductInput, opts),
  },
  "master.product.set-status": {
    requiredScope: SCOPES.writeMaster,
    write: true,
    summary: "启用/停用商品（软删，保留历史单据引用）",
    handler: async (actor, input, opts) => {
      const { productId, enabled } = input as { productId: number; enabled: boolean };
      return setProductStatus(actor, { productId, enabled }, opts);
    },
  },

  /* 客户/厂家：create 与 update 分成两个 op（动词不同、校验也不同），
     都落到同一个 saveXxx 服务函数上——服务里只有一份写逻辑。 */

  "master.customer.create": {
    requiredScope: SCOPES.writeMaster,
    write: true,
    summary: "新建客户（默认拒绝重名；默认预演）",
    // 明确丢掉 id：create 是 create，不会被一个多余的 --id 变成"悄悄改别人"
    handler: async (actor, input, opts) => saveCustomer(actor, { ...(input as SaveCustomerInput), id: undefined }, opts),
  },
  "master.customer.update": {
    requiredScope: SCOPES.writeMaster,
    write: true,
    summary: "更新客户（必须给 --id）",
    handler: async (actor, input, opts) => {
      if ((input as { id?: unknown }).id == null) return fail("INVALID", "更新必须给 --id（要新建请用 create）");
      return saveCustomer(actor, input as SaveCustomerInput, opts);
    },
  },
  "master.supplier.create": {
    requiredScope: SCOPES.writeMaster,
    write: true,
    summary: "新建厂家（默认拒绝重名；默认预演）",
    handler: async (actor, input, opts) => saveSupplier(actor, { ...(input as SaveSupplierInput), id: undefined }, opts),
  },
  "master.supplier.update": {
    requiredScope: SCOPES.writeMaster,
    write: true,
    summary: "更新厂家（必须给 --id）",
    handler: async (actor, input, opts) => {
      if ((input as { id?: unknown }).id == null) return fail("INVALID", "更新必须给 --id（要新建请用 create）");
      return saveSupplier(actor, input as SaveSupplierInput, opts);
    },
  },

  /**
   * 开售卖单。这是最重的一条写命令：会扣库存、按移动加权记成本快照、
   * 现场进货时还会自动生成并当场入库一张进货单。默认预演，`--yes` 才落库。
   */
  "order.sale.create": {
    requiredScope: SCOPES.writeOrder,
    write: true,
    summary: "开售卖单（默认预演；会扣库存与成本快照，现场进货还会自动生成进货单）",
    handler: async (actor, input, opts) => createSaleOrder(actor, input as CreateSaleOrderInput, opts),
  },

  /**
   * 开进货单。注意：**创建 ≠ 入库**——状态是 pending，库存与成本一动不动；
   * 货到了要用 order.purchase.receive 才进库存。
   */
  "order.purchase.create": {
    requiredScope: SCOPES.writeOrder,
    write: true,
    summary: "开进货单（默认预演；创建不等于入库，不碰库存）",
    handler: async (actor, input, opts) => createPurchaseOrder(actor, input as CreatePurchaseOrderInput, opts),
  },

  /* 收付款：动钱的操作，写操作声明照旧 → 默认预演 */
  "payment.create": {
    requiredScope: SCOPES.writePayment,
    write: true,
    summary: "登记收付款（一单一笔；收款对售卖单、付款对进货单）",
    handler: async (actor, input, opts) => createPayment(actor, input as CreatePaymentInput, opts),
  },
  "payment.void": {
    requiredScope: SCOPES.writePayment,
    write: true,
    summary: "作废收付款（冲回单据已收/已付；错了只能作废不能改）",
    handler: async (actor, input, opts) => {
      const { id, reason } = input as { id: number; reason: string };
      return voidPayment(actor, { id, reason }, opts);
    },
  },

  /* 单位/分类：名称即身份，重名一律拒绝（没有 allowDuplicate 的口子） */
  "master.unit.create": {
    requiredScope: SCOPES.writeMaster,
    write: true,
    summary: "新建单位（默认预演）",
    handler: async (actor, input, opts) => saveUnit(actor, { ...(input as SaveTaxonomyInput), id: undefined }, opts),
  },
  "master.unit.update": {
    requiredScope: SCOPES.writeMaster,
    write: true,
    summary: "重命名单位（必须给 --id）",
    handler: async (actor, input, opts) => {
      if ((input as { id?: unknown }).id == null) return fail("INVALID", "更新必须给 --id");
      return saveUnit(actor, input as SaveTaxonomyInput, opts);
    },
  },
  "master.unit.set-status": {
    requiredScope: SCOPES.writeMaster,
    write: true,
    summary: "启用/停用单位（软删）",
    handler: async (actor, input, opts) => {
      const { id, enabled } = input as { id: number; enabled: boolean };
      return setTaxonomyStatus(actor, "unit", { id, enabled }, opts);
    },
  },
  "master.category.create": {
    requiredScope: SCOPES.writeMaster,
    write: true,
    summary: "新建商品分类（默认预演）",
    handler: async (actor, input, opts) => saveCategory(actor, { ...(input as SaveTaxonomyInput), id: undefined }, opts),
  },
  "master.category.update": {
    requiredScope: SCOPES.writeMaster,
    write: true,
    summary: "重命名商品分类（必须给 --id）",
    handler: async (actor, input, opts) => {
      if ((input as { id?: unknown }).id == null) return fail("INVALID", "更新必须给 --id");
      return saveCategory(actor, input as SaveTaxonomyInput, opts);
    },
  },
  "master.category.set-status": {
    requiredScope: SCOPES.writeMaster,
    write: true,
    summary: "启用/停用商品分类（软删）",
    handler: async (actor, input, opts) => {
      const { id, enabled } = input as { id: number; enabled: boolean };
      return setTaxonomyStatus(actor, "category", { id, enabled }, opts);
    },
  },
};

export function findOp(name: string): OpDef | undefined {
  return OPS[name];
}

export function opNames(): string[] {
  return Object.keys(OPS).sort();
}
