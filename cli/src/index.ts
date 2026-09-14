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
    if (Array.isArray(v)) out.push([key, v.map((x) => String(x)).join(", ")]);
    else if (typeof v === "object") out.push(...flatten(v as Record<string, unknown>, key));
    else out.push([key, String(v)]);
  }
  return out;
}

/** 列表数据按列对齐输出（`--table` 遇到数组时用这个，一行一条记录） */
function renderRows(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "  （没有符合条件的记录）";
  const cols = Object.keys(rows[0]);
  const cells = rows.map((r) => cols.map((c) => (r[c] == null ? "" : String(r[c]))));
  const width = cols.map((c, i) => Math.max(c.length, ...cells.map((row) => row[i].length)));
  const line = (vals: string[]) => "  " + vals.map((v, i) => v.padEnd(width[i])).join("  ");
  return [line(cols), line(width.map((w) => "─".repeat(w))), ...cells.map(line)].join("\n");
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
