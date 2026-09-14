import { call, CliFailure, exitCodeOf, loadConfig, type CliConfig } from "./client";

/**
 * wc-cli —— 玮川进销存的命令行入口。
 *
 * 设计取向（给 Agent 用，计划 §6.3 / §7）：
 * - 默认输出 **JSON**（机器可读），`--table` 才是给人看的排版；
 * - 退出码规范化：0 成功 / 2 参数错 / 3 权限不足 / 4 业务规则拒绝 / 5 冲突 / 1 其他；
 * - 每条命令都要有 `--help` 与**示例**（Agent 最依赖示例）。
 *
 * 命令面现在只有鉴权自检（Phase 1 的最小闭环：能证明 CLI 拿到了合法身份）。
 * 查询与写命令按 Phase 2/3 逐步接上，接的时候只需在 COMMANDS 里加一行——
 * 权限判定不在 CLI 里做，一律由服务端注册表（src/lib/cli/registry.ts）说了算。
 */

interface Command {
  /** 服务端注册表里的 op 名 */
  op: string;
  summary: string;
  usage: string[];
  examples: string[];
}

const COMMANDS: Record<string, Command> = {
  "auth.whoami": {
    op: "auth.whoami",
    summary: "显示当前令牌对应的身份与权限（排查令牌配错的第一站）",
    usage: ["wc-cli auth whoami [--json|--table]"],
    examples: ["wc-cli auth whoami", "wc-cli auth whoami --table"],
  },
  "auth.check-review": {
    op: "auth.check-review",
    summary: "自检：人类专属操作，Agent 令牌调用必被拒绝（验证权限判定真的在生效）",
    usage: ["wc-cli auth check-review"],
    examples: ["wc-cli auth check-review   # Agent 令牌应得到退出码 3"],
  },
  "query.orders": {
    op: "query.orders",
    summary: "查售卖单列表（默认本月 1 日至今，与网页列表同口径）",
    usage: [
      "wc-cli query orders [--page N] [--page-size N] [--from YYYY-MM-DD] [--to YYYY-MM-DD]",
      "                    [--status confirmed|voided] [--settle settled|unsettled]",
      "                    [--customer-id N] [--q 关键词] [--starred] [--table]",
    ],
    examples: [
      "wc-cli query orders --table",
      "wc-cli query orders --settle unsettled --table   # 只看未结清",
      "wc-cli query orders --q zjw --from 2026-09-01 --to 2026-09-30",
      "wc-cli query orders --page 2 --page-size 50",
    ],
  },
  "query.purchase-orders": {
    op: "query.purchase-orders",
    summary: "查进货单列表（默认本月 1 日至今）",
    usage: [
      "wc-cli query purchase-orders [--page N] [--page-size N] [--from YYYY-MM-DD] [--to YYYY-MM-DD]",
      "                              [--status pending|received|voided] [--settle settled|unsettled]",
      "                              [--supplier-id N] [--q 关键词] [--starred] [--table]",
    ],
    examples: [
      "wc-cli query purchase-orders --table",
      "wc-cli query purchase-orders --status pending --table    # 待收货的",
      "wc-cli query purchase-orders --settle unsettled --table  # 还欠厂家钱的",
    ],
  },
  "query.inventory": {
    op: "query.inventory",
    summary: "查库存（--warn-only 只看跌破预警线的）",
    usage: [
      "wc-cli query inventory [--page N] [--page-size N] [--q 关键词] [--warn-only]",
      "                       [--category N|none] [--manufacturer 名|none]",
      "                       [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--table]",
    ],
    examples: [
      "wc-cli query inventory --table",
      "wc-cli query inventory --warn-only --table   # 只看跌破预警线的",
      "wc-cli query inventory --q zjw --table       # 拼音首字母也能搜",
    ],
  },
  "query.products": {
    op: "query.products",
    summary: "查商品档案（开单前用它把商品名换成 id）",
    usage: [
      "wc-cli query products [--q 关键词] [--page N] [--page-size N]",
      "                      [--category N|none] [--manufacturer 名|none] [--enabled-only] [--table]",
    ],
    examples: [
      "wc-cli query products --q dxtx --table        # 拼音首字母搜「单芯铜线」",
      "wc-cli query products --manufacturer none --table   # 还没填厂家的商品",
      "wc-cli query products --category none --table       # 还没分类的商品",
    ],
  },
  "query.customers": {
    op: "query.customers",
    summary: "查客户（名称/电话/分组/标签）",
    usage: [
      "wc-cli query customers [--q 关键词] [--page N] [--page-size N]",
      "                       [--group-id N|none] [--tag-id N] [--table]",
    ],
    examples: [
      "wc-cli query customers --q zjw --table",
      "wc-cli query customers --group-id none --table   # 还没分组的客户",
    ],
  },
  "query.suppliers": {
    op: "query.suppliers",
    summary: "查厂家（含该厂家名下商品数）",
    usage: ["wc-cli query suppliers [--q 关键词] [--status 1|0] [--page N] [--table]"],
    examples: ["wc-cli query suppliers --table", "wc-cli query suppliers --q yddl --table"],
  },
  "query.units": {
    op: "query.units",
    summary: "查单位（开单要填 unitId）",
    usage: ["wc-cli query units [--q 关键词] [--table]"],
    examples: ["wc-cli query units --table"],
  },
  "query.categories": {
    op: "query.categories",
    summary: "查商品分类（补单/建档要填 categoryId）",
    usage: ["wc-cli query categories [--q 关键词] [--table]"],
    examples: ["wc-cli query categories --table"],
  },
  "query.receivables": {
    op: "query.receivables",
    summary: "查应收（两个合计口径都在返回里：区间合计 / 当前存量）",
    usage: [
      "wc-cli query receivables [--counter-id N] [--from YYYY-MM-DD] [--to YYYY-MM-DD]",
      "                      [--page N] [--page-size N] [--table]",
    ],
    examples: [
      "wc-cli query receivables --table",
      "wc-cli query receivables --counter-id 1 --table   # 只看某个客户的",
    ],
  },
  "query.payables": {
    op: "query.payables",
    summary: "查应付（还欠厂家多少钱）",
    usage: [
      "wc-cli query payables [--counter-id N] [--from YYYY-MM-DD] [--to YYYY-MM-DD]",
      "                     [--page N] [--page-size N] [--table]",
    ],
    examples: ["wc-cli query payables --table", "wc-cli query payables --counter-id 2 --table"],
  },
  "query.payments": {
    op: "query.payments",
    summary: "查收付款流水（默认只看已登记）",
    usage: [
      "wc-cli query payments [--direction receipt|payment] [--status confirmed|voided|all]",
      "                     [--q 关键词] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--page N] [--table]",
    ],
    examples: [
      "wc-cli query payments --table",
      "wc-cli query payments --direction receipt --table    # 只看收款",
      "wc-cli query payments --status all --table           # 含已作废",
      "wc-cli query payments --q zjw --table                # 按客户名找他的款",
    ],
  },
  "query.movements": {
    op: "query.movements",
    summary: "查库存流水（含变动前后数量与当次单价）",
    usage: [
      "wc-cli query movements [--product-id N] [--biz-type purchase_in|sale_out|...]",
      "                       [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--page N] [--table]",
    ],
    examples: [
      "wc-cli query movements --table",
      "wc-cli query movements --product-id 1 --table                     # 某个商品的进销存轨迹",
      "wc-cli query movements --biz-type sale_return_in --table          # 只看销售退货",
    ],
  },
  "query.report": {
    op: "query.report",
    summary: "跑报表（汇总同时给毛额与净额；估价待补行会标注成本未计）",
    usage: [
      "wc-cli query report [--tab inventory|summary|payables|receivables|sales-rank|operator-perf]",
      "                    [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--table]",
    ],
    examples: [
      "wc-cli query report --tab summary --table",
      "wc-cli query report --tab sales-rank --table",
      "wc-cli query report --tab summary --from 2026-09-01 --to 2026-09-30 --table",
    ],
  },
  "query.audit-logs": {
    op: "query.audit-logs",
    summary: "查审计日志（仅管理员；可按实体/用户/动作筛）",
    usage: [
      "wc-cli query audit-logs [--entity-type product] [--entity-id N] [--username admin]",
      "                        [--action create|update|void|...] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--table]",
    ],
    examples: [
      "wc-cli query audit-logs --table",
      "wc-cli query audit-logs --entity-type product --table    # 商品档案被谁改过",
      "wc-cli query audit-logs --username admin --action create --table",
    ],
  },
};

const VERSION = "0.1.0";

function mainHelp(): string {
  const lines = [
    `wc-cli ${VERSION} — 玮川进销存命令行（默认 JSON 输出，写操作默认 dry-run）`,
    "",
    "用法：wc-cli <命令> [参数] [--json|--table] [--run <批次id>]",
    "",
    "命令：",
  ];
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    lines.push(`  ${name.replace(".", " ").padEnd(22)}${cmd.summary}`);
  }
  lines.push(
    "",
    "环境变量：",
    `  WC_TOKEN     访问令牌（也可写到 ~/.config/weichuan/token）；不要写进命令行参数`,
    `  WC_BASE_URL  服务地址，默认 http://127.0.0.1:3000`,
    "",
    "退出码：0 成功 / 2 参数错 / 3 权限不足 / 4 业务规则拒绝 / 5 冲突 / 1 其他",
    "",
    "示例：",
    ...Object.values(COMMANDS).flatMap((c) => c.examples.map((e) => `  ${e}`)),
  );
  return lines.join("\n");
}

function commandHelp(name: string, cmd: Command): string {
  return [
    `wc-cli ${name.replace(".", " ")} — ${cmd.summary}`,
    "",
    "用法：",
    ...cmd.usage.map((u) => `  ${u}`),
    "",
    "示例：",
    ...cmd.examples.map((e) => `  ${e}`),
  ].join("\n");
}

/** 找出命令名：先试"两段式"（auth whoami），再试一段式 */
function resolveCommand(argv: string[]): { key: string; rest: string[] } | null {
  if (argv.length === 0) return null;
  if (argv.length >= 2) {
    const two = `${argv[0]}.${argv[1]}`;
    if (two in COMMANDS) return { key: two, rest: argv.slice(2) };
  }
  if (argv[0] in COMMANDS) return { key: argv[0], rest: argv.slice(1) };
  return null;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(`--${flag}`);
}

function valueOf(args: string[], flag: string): string | undefined {
  const i = args.indexOf(`--${flag}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** 需要转成数字的入参（其余按字符串）；与 registry 里各命令的 zod 校验对应 */
const NUMERIC_KEYS = new Set(["page", "pageSize", "customerId"]);

/**
 * 把 `--page-size 50` / `--starred` 这串参数转成 op 的 input。
 * kebab-case → camelCase（--page-size → pageSize）；
 * 后面紧跟 `--` 开头或已到末尾的，视为布尔 true。
 */
function buildInput(args: string[]): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) continue;
    const key = args[i].slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    // --json / --table / --help / --run 由 CLI 自己消费，不进 input
    if (key === "json" || key === "table" || key === "help" || key === "run") continue;
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      input[key] = true;
      continue;
    }
    input[key] = NUMERIC_KEYS.has(key) ? Number(next) : next;
    i++;
  }
  return input;
}

/** 把嵌套对象摊平成"点号路径 → 值"，便于两列对齐 */
function flatten(data: Record<string, unknown>, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(data)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v == null) continue;
    if (Array.isArray(v)) {
      // 数组：基元直接列出，对象只报个数（明细在 --json 里，表格塞不下）
      out.push([key, v.length === 0 ? "（空）" : typeof v[0] === "object" ? `${v.length} 项` : v.map((x) => String(x)).join(", ")]);
    } else if (typeof v === "object") {
      out.push(...flatten(v as Record<string, unknown>, key));
    } else {
      out.push([key, String(v)]);
    }
  }
  return out;
}

/**
 * 列表数据按列对齐输出（`--table` 遇到数组时用这个，一行一条记录）。
 * 只把基元字段当列：嵌套的对象/数组（明细行、按对方汇总）在表格里塞不下，
 * 想看全用 `--json` —— 总比显示一排 [object Object] 强。
 */
function renderRows(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "  （没有符合条件的记录）";
  const cols = Object.keys(rows[0]).filter((c) => {
    const v = rows[0][c];
    return v == null || typeof v !== "object";
  });
  const cells = rows.map((r) => cols.map((c) => (r[c] == null ? "" : String(r[c]))));
  const width = cols.map((c, i) => Math.max(c.length, ...cells.map((row) => row[i].length)));
  const line = (vals: string[]) => "  " + vals.map((v, i) => v.padEnd(width[i])).join("  ");
  const body = [line(cols), line(width.map((w) => "─".repeat(w))), ...cells.map(line)].join("\n");
  const hidden = Object.keys(rows[0]).length - cols.length;
  return hidden > 0 ? `${body}\n  （另有 ${hidden} 个字段是明细/汇总，用 --json 查看）` : body;
}

/** 排成两列给人看（标量数据用） */
function renderTable(data: Record<string, unknown>): string {
  // 列表命令：data.rows 是记录数组 → 逐行成表
  const rows = (data as { rows?: unknown }).rows;
  if (Array.isArray(rows) && rows.length > 0 && typeof rows[0] === "object") {
    const head = flatten(
      Object.fromEntries(Object.entries(data).filter(([k]) => k !== "rows" && k !== "applied"))
    );
    const summary = head.length > 0 ? head.map(([k, v]) => `  ${k.padEnd(12)}  ${v}`).join("\n") + "\n\n" : "";
    const applied = data.applied != null ? "\n\n  生效条件：" + JSON.stringify(data.applied) : "";
    return summary + renderRows(rows as Record<string, unknown>[]) + applied;
  }
  const flat = flatten(data);
  if (flat.length === 0) return "  （无数据）";
  const width = Math.max(...flat.map(([k]) => k.length));
  return flat.map(([k, v]) => `  ${k.padEnd(width)}  ${v}`).join("\n");
}

async function run(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    console.log(mainHelp());
    return 0;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    console.log(VERSION);
    return 0;
  }

  const resolved = resolveCommand(argv);
  if (!resolved) {
    throw new CliFailure("INVALID", `未知命令：${argv.join(" ")}\n\n${mainHelp()}`);
  }
  const { key, rest } = resolved;
  const cmd = COMMANDS[key];

  if (hasFlag(rest, "help") || rest.includes("-h")) {
    console.log(commandHelp(key, cmd));
    return 0;
  }

  const cfg: CliConfig = loadConfig();
  const asTable = hasFlag(rest, "table");
  const data = await call<Record<string, unknown>>(cfg, {
    op: cmd.op,
    input: buildInput(rest),
    runId: valueOf(rest, "run"),
    dryRun: hasFlag(rest, "dry-run") ? true : undefined,
  });

  if (asTable) {
    console.log(renderTable(data));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
  return 0;
}

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    if (e instanceof CliFailure) {
      console.error(`错误：${e.message}`);
      process.exitCode = exitCodeOf(e.code);
      return;
    }
    console.error(`未预期的错误：${e instanceof Error ? e.stack : String(e)}`);
    process.exitCode = 1;
  });
