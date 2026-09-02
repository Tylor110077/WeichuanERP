import "server-only";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

/**
 * 审计日志写入内核（文档 3.10 / 7.5）：
 * 记录操作人、时间、IP、动作、对象类型与编号、变更前后值（JSON 快照）。
 * 审计表只增不改不删（业务上无删除接口；数据库层面由迁移权限约束）。
 * 审计写入失败不阻断业务（打印错误，交由运维报表发现）。
 */

export interface AuditParams {
  /** 操作人；登录失败等场景可为空 */
  userId?: number | null;
  action: "login" | "logout" | "create" | "update" | "delete" | "receive" | "void" | "reset_password";
  entityType: string;
  entityId?: number | string | bigint | null;
  /** 变更前快照（对象原样传入，内部序列化） */
  before?: unknown;
  /** 变更后快照 */
  after?: unknown;
  ip?: string | null;
}

export async function writeAudit(params: AuditParams): Promise<void> {
  try {
    let ip = params.ip ?? null;
    if (ip === null) {
      const h = await headers();
      ip =
        h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        h.get("x-real-ip") ??
        null;
    }
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId != null ? BigInt(params.entityId) : null,
        beforeJson: params.before != null ? (params.before as object) : undefined,
        afterJson: params.after != null ? (params.after as object) : undefined,
        ip,
      },
    });
  } catch (err) {
    // 审计写入失败不该让业务事务失败；记录到服务端日志
    console.error("[audit] 审计日志写入失败:", err);
  }
}
