import { headers } from "next/headers";
import { prisma, type TxClient } from "@/lib/prisma";

/**
 * 审计日志写入内核（文档 3.10 / 7.5）：
 * 记录操作人、时间、IP、动作、对象类型与编号、变更前后值（JSON 快照）。
 * 审计表只增不改不删（业务上无删除接口；数据库层面由迁移权限约束）。
 *
 * **刻意不 import "server-only"**：审计要被服务层、本地脚本、将来的 CLI 端点一起用，
 * 而 server-only 会让 tsx 进程外直接抛错（同类先例见 lib/pinyin-server.ts 的注释）。
 * "只在服务端跑"由调用方承担——本模块只依赖 prisma 与可选的请求上下文。
 *
 * 三条写入纪律（改起来容易踩，写在最前面）：
 * 1. **事务内要用 `tx`**：传了 `tx` 就与业务同一个事务，业务回滚审计跟着回滚；
 *    不传则走独立连接、立即提交——业务回滚后审计会残留（历史缺陷，见 §5.2）。
 * 2. **数字主键给 `entityId`，字符串标识给 `entityKey`**：字符串走 `entityId` 会被
 *    `BigInt()` 抛错后静默丢弃（"备份配置变更"因此长期无审计）。
 * 3. **进程外没有请求上下文**：`headers()` 会抛错，此时写 null IP 也要把审计落下来。
 */

export type AuditAction =
  | "login"
  | "logout"
  | "create"
  | "update"
  | "delete"
  | "receive"
  | "void"
  | "reset_password";

export interface AuditParams {
  /** 操作人；登录失败等场景可为空 */
  userId?: number | null;
  action: AuditAction;
  entityType: string;
  /** 数字主键（可被按 id 检索）；字符串标识请交给 entityKey */
  entityId?: number | string | bigint | null;
  /** 变更前快照（对象原样传入，内部序列化） */
  before?: unknown;
  /** 变更后快照 */
  after?: unknown;
  /** 显式指定 IP；**进程外调用必须传**（没有请求上下文时拿不到） */
  ip?: string | null;
  /** 传入事务客户端 → 审计与业务同事务（写不进去就一起失败，不留"无痕变更"） */
  tx?: TxClient;
}

/**
 * 写入审计。
 *
 * 失败策略：
 * - **传了 `tx`**（业务事务内）→ 抛出去，让业务一起回滚。同一套库，审计都写不进去，
 *   说明事务本身已经坏了；"钱和库存都变了却查不到谁干的"比"这次请求失败"更糟。
 * - **没传 `tx`**（页面级调用，业务已提交）→ 不阻断业务，但必须**响亮**：日志前缀
 *   `[audit][LOST]` 便于检索告警，而不是像以前那样只在控制台悄悄打一行。
 */
export async function writeAudit(params: AuditParams): Promise<void> {
  const db = params.tx ?? prisma;
  const id = splitEntityId(params.entityId);
  const ip = params.ip !== undefined ? params.ip : await tryRequestIp();

  try {
    await db.auditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: id.entityId,
        entityKey: id.entityKey,
        beforeJson: params.before != null ? (params.before as object) : undefined,
        afterJson: params.after != null ? (params.after as object) : undefined,
        ip,
      },
    });
  } catch (err) {
    if (params.tx) throw err;
    console.error(
      `[audit][LOST] 审计写入失败，业务已继续（这条 ${params.action} ${params.entityType} 变更没有痕迹）:`,
      err
    );
  }
}

/**
 * 拆分标识：
 * - 纯数字/数字串 → `entityId`（保持历史行为：以前 `BigInt("123")` 也是能落库的）
 * - 其它字符串 → `entityKey`（"backup-config" 这类，以前会被静默丢弃）
 */
function splitEntityId(v: AuditParams["entityId"]): { entityId: bigint | null; entityKey: string | null } {
  if (v == null) return { entityId: null, entityKey: null };
  if (typeof v === "bigint") return { entityId: v, entityKey: null };
  if (typeof v === "number") {
    return { entityId: Number.isFinite(v) ? BigInt(Math.trunc(v)) : null, entityKey: null };
  }
  const text = v.trim();
  if (text === "") return { entityId: null, entityKey: null };
  if (/^\d+$/.test(text)) return { entityId: BigInt(text), entityKey: null };
  return { entityId: null, entityKey: text.slice(0, 64) };
}

/** 请求上下文里取 IP；进程外（脚本/服务层/端点外的调用）没有上下文，返回 null 而不抛错 */
async function tryRequestIp(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  } catch {
    return null;
  }
}
