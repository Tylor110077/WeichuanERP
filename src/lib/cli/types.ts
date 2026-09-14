/**
 * CLI / Agent 通道的共享类型（服务层、端点层、CLI 三边共用）。
 *
 * 这里定的是**契约**：所有命令都返回 CliResult，错误一律带 code；
 * code 到 HTTP 状态、到 CLI 退出码的映射也只在这里定义一次，
 * 避免三个地方各写一遍、慢慢对不上。
 */

/** 操作者。人的会话（cookie）与 Agent 的令牌（Bearer）最终都归一成这个形状。 */
export interface Actor {
  /** human = 网页上的人；agent = 走令牌的 CLI/脚本。溯源与审核按它区分 */
  kind: "human" | "agent";
  userId: number;
  username: string;
  displayName: string;
  role: "admin" | "sales" | "boss";
  /** 权限词表，见 SCOPE_* 常量；人类会话默认全量 */
  scopes: string[];
  /** 仅 agent：哪个令牌（审计与限流用） */
  tokenId?: number;
  tokenName?: string;
  /** 一次需求 = 一个 runId = 一批单据；审核台按它整批过 */
  runId?: string | null;
}

/**
 * 权限词表（够用就好，不设计成 RBAC）。
 * 关键约束：`review` 只发给人类令牌——审核是人类的职责，从权限上就杜绝"Agent 自审自批"。
 */
export const SCOPES = {
  read: "read",
  writeOrder: "write:order",
  writeMaster: "write:master",
  writePayment: "write:payment",
  /** 审核（通过/驳回/修订）。Agent 令牌一律不含 */
  review: "review",
  /** 运维（备份等）。restore/download 永不授予 Agent */
  ops: "ops",
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

export const ALL_SCOPES: Scope[] = Object.values(SCOPES);

/** 发给 Agent 的默认权限：能读、能开单/收付，但**没有 review** */
export const DEFAULT_AGENT_SCOPES: Scope[] = [
  SCOPES.read,
  SCOPES.writeOrder,
  SCOPES.writePayment,
];

export type CliErrorCode =
  | "INVALID" // 参数/请求体不合法
  | "UNAUTHORIZED" // 没有或无效的身份
  | "FORBIDDEN" // 身份有效但没权限
  | "NOT_FOUND" // 未知命令 / 资源不存在
  | "CONFLICT" // 并发冲突（唯一键、状态被改动）
  | "RULE" // 业务规则拒绝（如状态不允许作废）
  | "INTERNAL"; // 兜底

/** 错误码 → HTTP 状态（端点层用） */
export const ERROR_STATUS: Record<CliErrorCode, number> = {
  INVALID: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RULE: 422,
  INTERNAL: 500,
};

/**
 * 错误码 → CLI 退出码（cli/ 用）。
 * 约定见计划 §6.3：0 成功 / 2 参数错 / 3 权限不足 / 4 业务规则拒绝 / 5 冲突；
 * 其余（含内部错误）归 1，与 shell 的"一般错误"一致。
 */
export const EXIT_CODE: Record<CliErrorCode, number> = {
  INVALID: 2,
  UNAUTHORIZED: 3,
  FORBIDDEN: 3,
  RULE: 4,
  CONFLICT: 5,
  NOT_FOUND: 2,
  INTERNAL: 1,
};

export type CliResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: CliErrorCode; message: string } };

export function ok<T>(data: T): CliResult<T> {
  return { ok: true, data };
}

export function fail(code: CliErrorCode, message: string): CliResult<never> {
  return { ok: false, error: { code, message } };
}
