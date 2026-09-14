import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EXIT_CODE, type CliErrorCode } from "@/lib/cli/types";

/**
 * HTTP 客户端：CLI 只通过这里与系统对话。
 *
 * 三条硬纪律（计划 §6.2 / §6.3）：
 * 1. **绝不直连数据库**：生产上宿主机根本连不到库（compose 里 mysql 没有端口映射），
 *    而且绕过服务层就等于绕过权限与审计；
 * 2. **令牌只从环境变量或文件读**，绝不从命令行参数读——参数会进 shell 历史与进程列表；
 * 3. **写操作默认 dry-run**，必须显式 --yes 才落库（Phase 3 起生效，现在没有写命令）。
 */

export interface CliConfig {
  baseUrl: string;
  token: string;
  /** 令牌来源，仅用于报错时提示去哪儿找 */
  tokenFrom: string;
}

const TOKEN_FILE = join(homedir(), ".config", "weichuan", "token");

export function loadConfig(): CliConfig {
  const baseUrl = (process.env.WC_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");

  if (process.env.WC_TOKEN) {
    return { baseUrl, token: process.env.WC_TOKEN.trim(), tokenFrom: "环境变量 WC_TOKEN" };
  }
  try {
    const token = readFileSync(TOKEN_FILE, "utf8").trim();
    if (token) return { baseUrl, token, tokenFrom: TOKEN_FILE };
  } catch {
    // 文件不存在是正常情况（还没配过），下面统一报错
  }
  throw new CliFailure(
    "UNAUTHORIZED",
    `没有找到令牌。请设置环境变量 WC_TOKEN，或把令牌写入 ${TOKEN_FILE}\n` +
      `铸造令牌：npx tsx scripts/api-token.ts create --user admin --name "Agent 开单"`
  );
}

export class CliFailure extends Error {
  constructor(
    readonly code: CliErrorCode,
    message: string
  ) {
    super(message);
  }
}

export interface CallOptions {
  op: string;
  input?: Record<string, unknown>;
  runId?: string;
  dryRun?: boolean;
}

/** 调一次端点。业务失败（ok:false）抛 CliFailure，由入口统一转成退出码。 */
export async function call<T>(cfg: CliConfig, opts: CallOptions): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/api/cli/v1`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ op: opts.op, input: opts.input ?? {}, runId: opts.runId, dryRun: opts.dryRun }),
    });
  } catch (e) {
    throw new CliFailure(
      "INTERNAL",
      `连不上 ${cfg.baseUrl}（${e instanceof Error ? e.message : String(e)}）\n` +
        "  服务没起？用 WC_BASE_URL 指定地址，例如 WC_BASE_URL=http://127.0.0.1:3000"
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new CliFailure("INTERNAL", `服务返回了非 JSON 内容（HTTP ${res.status}）`);
  }

  const parsed = body as
    | { ok: true; data: T }
    | { ok: false; error?: { code?: string; message?: string } };
  if (parsed.ok) return parsed.data;

  const code = (parsed.error?.code ?? "INTERNAL") as CliErrorCode;
  throw new CliFailure(code, parsed.error?.message ?? `请求失败（HTTP ${res.status}）`);
}

/** 业务错误码 → 进程退出码（映射表在 src/lib/cli/types.ts，只定义一次） */
export function exitCodeOf(code: CliErrorCode): number {
  return EXIT_CODE[code] ?? 1;
}
