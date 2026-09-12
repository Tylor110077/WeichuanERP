import type { UserRole } from "@prisma/client";

/**
 * 工作台快捷入口目录。
 *
 * 工作台上显示哪些入口由用户自己决定（`User.shortcuts` 存的是这里的 id 数组），
 * 因此这个目录是唯一的「可选清单」：新增一个入口只改这里，工作台的编辑面板自动出现它。
 *
 * 约定：
 * - `id` 一旦发布就不要再改（用户库里存的是 id，改了等于丢配置）；入口下线时把 id 从数组里去掉即可，
 *   读取侧会忽略不认识的 id（见 `resolveShortcuts`）。
 * - `roles` 与侧边栏/页面权限保持一致：看不到的页面不该出现在快捷入口里，
 *   否则用户点了会撞到「无权限」。
 * - `badge` 是方格里的一个字，用来在没有图标库的情况下让每块好认。
 */

export interface ShortcutDef {
  id: string;
  label: string;
  href: string;
  /** 一句话说明，显示在入口标题下面 */
  desc: string;
  /** 分组名，编辑面板按组列可选项 */
  group: string;
  /** 方格里的标识字 */
  badge: string;
  roles: readonly UserRole[];
}

const ALL: readonly UserRole[] = ["admin", "sales", "boss"];
const NO_SALES: readonly UserRole[] = ["admin", "boss"]; // 业务员看不到进价/毛利相关
const ADMIN_ONLY: readonly UserRole[] = ["admin"];

export const SHORTCUTS: ShortcutDef[] = [
  // 开单
  {
    id: "sale-new",
    label: "开售卖单",
    href: "/sale-orders/new",
    desc: "给客户开单，缺货可自动向厂家补货",
    group: "开单",
    badge: "售",
    roles: ["admin", "sales"],
  },
  {
    id: "purchase-new",
    label: "开进货单",
    href: "/purchase-orders/new",
    desc: "向厂家进货，入库后计入库存成本",
    group: "开单",
    badge: "进",
    roles: ["admin", "sales"],
  },

  // 单据
  {
    id: "sale-orders",
    label: "售卖单",
    href: "/sale-orders",
    desc: "查单、登记收款、作废",
    group: "单据",
    badge: "单",
    roles: ALL,
  },
  {
    id: "purchase-orders",
    label: "进货单",
    href: "/purchase-orders",
    desc: "查单、入库、登记付款",
    group: "单据",
    badge: "货",
    roles: ALL,
  },
  {
    id: "sale-returns",
    label: "退货单",
    href: "/sale-returns",
    desc: "客户退货与厂家退货",
    group: "单据",
    badge: "退",
    roles: ALL,
  },

  // 库存
  {
    id: "inventory",
    label: "库存查询",
    href: "/inventory",
    desc: "按分类、厂家、进货时间查库存",
    group: "库存",
    badge: "库",
    roles: ALL,
  },
  {
    id: "stock-movements",
    label: "库存流水",
    href: "/stock-movements",
    desc: "每一笔出入库的明细",
    group: "库存",
    badge: "流",
    roles: NO_SALES,
  },

  // 财务分析
  {
    id: "receivables",
    label: "应收应付",
    href: "/receivables-payables",
    desc: "谁欠我们、我们欠谁",
    group: "财务分析",
    badge: "账",
    roles: NO_SALES,
  },
  {
    id: "sales-analysis",
    label: "销售分析",
    href: "/sales-analysis",
    desc: "按客户、按商品看销量与毛利",
    group: "财务分析",
    badge: "销",
    roles: NO_SALES,
  },
  {
    id: "price-analysis",
    label: "价格分析",
    href: "/price-analysis",
    desc: "售价与进价对比",
    group: "财务分析",
    badge: "价",
    roles: NO_SALES,
  },
  {
    id: "reports",
    label: "报表中心",
    href: "/reports",
    desc: "汇总报表，可导出 Excel",
    group: "财务分析",
    badge: "报",
    roles: NO_SALES,
  },

  // 资料
  {
    id: "products",
    label: "商品与厂家",
    href: "/products",
    desc: "商品、厂家、分类、计量单位",
    group: "资料",
    badge: "商",
    roles: ALL,
  },
  {
    id: "customers",
    label: "客户管理",
    href: "/customers",
    desc: "客户、组织、标签、画像",
    group: "资料",
    badge: "客",
    roles: ALL,
  },
  {
    id: "product-new",
    label: "新建商品",
    href: "/products/new",
    desc: "登记一个新商品",
    group: "资料",
    badge: "新",
    roles: ADMIN_ONLY,
  },
  {
    id: "customer-new",
    label: "新建客户",
    href: "/customers/new",
    desc: "登记一个新客户",
    group: "资料",
    badge: "＋",
    roles: ADMIN_ONLY,
  },

  // 系统
  {
    id: "users",
    label: "用户管理",
    href: "/users",
    desc: "账号、角色与密码重置",
    group: "系统",
    badge: "人",
    roles: ADMIN_ONLY,
  },
  {
    id: "audit-logs",
    label: "审计日志",
    href: "/audit-logs",
    desc: "谁在什么时候改了什么",
    group: "系统",
    badge: "审",
    roles: ADMIN_ONLY,
  },
  {
    id: "login-logs",
    label: "登录日志",
    href: "/login-logs",
    desc: "登录与失败记录",
    group: "系统",
    badge: "登",
    roles: ADMIN_ONLY,
  },
  {
    id: "profile",
    label: "个人中心",
    href: "/profile",
    desc: "改自己的姓名与密码",
    group: "系统",
    badge: "我",
    roles: ALL,
  },
];

/** 编辑面板按这个顺序分组展示可选项 */
export const SHORTCUT_GROUPS = ["开单", "单据", "库存", "财务分析", "资料", "系统"] as const;

/** 一个用户最多放几个入口：太多等于没有重点 */
export const MAX_SHORTCUTS = 12;

/** 没自定义过（shortcuts 为 NULL）时，按角色给一套默认 */
const DEFAULT_IDS: Partial<Record<UserRole, string[]>> = {
  admin: ["sale-new", "purchase-new", "inventory", "receivables", "products", "customers"],
  sales: ["sale-new", "purchase-new", "sale-orders", "inventory", "products", "customers"],
  boss: ["sale-orders", "purchase-orders", "inventory", "receivables", "sales-analysis", "reports"],
};

/** 该角色能看到的全部入口（编辑面板的候选） */
export function catalogForRole(role: UserRole): ShortcutDef[] {
  return SHORTCUTS.filter((s) => s.roles.includes(role));
}

/** 该角色的默认入口 */
export function defaultShortcutIds(role: UserRole): string[] {
  const allowed = new Set(catalogForRole(role).map((s) => s.id));
  return (DEFAULT_IDS[role] ?? []).filter((id) => allowed.has(id));
}

/**
 * 把库里存的 id 数组还原成入口对象：丢掉不认识的 id（入口已下线）与当前角色无权访问的，
 * 去重并截断到上限。用户在角色变更后可能留下越权的 id，这里兜住。
 */
export function resolveShortcuts(
  ids: readonly string[] | null | undefined,
  role: UserRole
): ShortcutDef[] {
  const byId = new Map(catalogForRole(role).map((s) => [s.id, s]));
  const seen = new Set<string>();
  const out: ShortcutDef[] = [];
  for (const id of ids ?? []) {
    if (seen.has(id)) continue;
    const def = byId.get(id);
    if (!def) continue;
    seen.add(id);
    out.push(def);
    if (out.length >= MAX_SHORTCUTS) break;
  }
  return out;
}

/** 从数据库列（Json）里读出 id 数组，容错处理历史脏数据 */
export function readShortcutIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === "string");
}
