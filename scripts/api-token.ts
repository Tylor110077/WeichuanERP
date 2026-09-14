/**
 * CLI / Agent 令牌的本地管理（铸造 / 列表 / 吊销）。
 *
 * 为什么是"本地脚本"而不是网页接口：
 * 铸造令牌本身需要受信环境——如果做成 HTTP 接口，就等于开了一个"用令牌换令牌"的口子。
 * 所以按计划 §6.2 的做法：本地受信执行（能连库的人本来就能改一切）。
 *
 * 用法：
 *   npx tsx scripts/api-token.ts create --user admin --name "Agent 开单"
 *        [--scopes read,write:order,write:payment]   # 默认不含 review
 *        [--expires 90d]                              # 不填＝长期有效
 *   npx tsx scripts/api-token.ts list
 *   npx tsx scripts/api-token.ts revoke --id 3
 *
 * 明文只在 create 时打印一次，库里只存 sha256（与 sessions 同一套做法）。
 */
import { hashToken, newTokenPlaintext } from "@/lib/auth/api-token";
import { prisma } from "@/lib/prisma";
import { ALL_SCOPES, DEFAULT_AGENT_SCOPES, type Scope } from "@/lib/cli/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 解析 "90d" / "24h" / "30m"；不填=长期有效（null） */
function parseExpires(raw: string | undefined): Date | null {
  if (!raw) return null;
  const m = /^(\d+)([dhm])$/.exec(raw.trim());
  if (!m) throw new Error(`--expires 格式应为 90d / 24h / 30m，收到：${raw}`);
  const n = Number(m[1]);
  const ms = m[2] === "d" ? n * 86400_000 : m[2] === "h" ? n * 3600_000 : n * 60_000;
  return new Date(Date.now() + ms);
}

function parseScopes(raw: string | undefined): Scope[] {
  if (!raw) return DEFAULT_AGENT_SCOPES;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = list.filter((s) => !ALL_SCOPES.includes(s as Scope));
  if (bad.length > 0) {
    throw new Error(`未知权限：${bad.join(", ")}（可用：${ALL_SCOPES.join(", ")}）`);
  }
  return list as Scope[];
}

async function create() {
  const username = arg("user") ?? "admin";
  const name = arg("name") ?? "CLI 令牌";
  const scopes = parseScopes(arg("scopes"));
  const expiresAt = parseExpires(arg("expires"));

  const user = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true, role: true } });
  if (!user) throw new Error(`用户不存在：${username}`);

  const plaintext = newTokenPlaintext();
  const token = await prisma.$transaction(async (tx) => {
    const row = await tx.apiToken.create({
      data: { userId: user.id, name, tokenHash: hashToken(plaintext), scopes, expiresAt },
      select: { id: true },
    });
    // 审计：本地脚本没有请求上下文，所以显式传 ip；
    // 注意**不记录明文**，只记用途与权限范围
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "create",
        entityType: "api_token",
        entityId: BigInt(row.id),
        afterJson: { name, scopes, expiresAt: expiresAt?.toISOString() ?? null },
        ip: "local-script",
      },
    });
    return row;
  });

  console.log(`已创建令牌 #${token.id}`);
  console.log(`  用户：${user.username}（${user.role}）`);
  console.log(`  用途：${name}`);
  console.log(`  权限：${scopes.join(", ")}${scopes.includes("review") ? "" : "  ← 不含 review（Agent 不能自审自批）"}`);
  console.log(`  有效期：${expiresAt ? expiresAt.toISOString() : "长期有效"}`);
  console.log("");
  console.log("明文令牌（只显示这一次，请立即保存）：");
  console.log(`  ${plaintext}`);
  console.log("");
  console.log("用它可以这样调用（不要写进命令行参数，会进 shell 历史）：");
  console.log(`  export WC_TOKEN=${plaintext.slice(0, 12)}…   # 或写入 ~/.config/weichuan/token`);
}

async function list() {
  const rows = await prisma.apiToken.findMany({
    include: { user: { select: { username: true } } },
    orderBy: { id: "asc" },
  });
  if (rows.length === 0) {
    console.log("还没有任何令牌。用 create 铸造一个：");
    console.log('  npx tsx scripts/api-token.ts create --user admin --name "Agent 开单"');
    return;
  }
  const now = Date.now();
  console.log("id  用户      用途              权限                             状态      最近使用");
  for (const r of rows) {
    const expired = r.expiresAt != null && r.expiresAt.getTime() <= now;
    const state = r.revokedAt ? "已吊销" : expired ? "已过期" : "有效";
    const scopes = (Array.isArray(r.scopes) ? (r.scopes as string[]) : []).join(",");
    console.log(
      [
        String(r.id).padEnd(3),
        r.user.username.padEnd(9),
        r.name.padEnd(17),
        scopes.padEnd(32),
        state.padEnd(9),
        r.lastUsedAt ? r.lastUsedAt.toISOString().slice(0, 16).replace("T", " ") : "—",
      ].join(" ")
    );
  }
}

async function revoke() {
  const id = Number(arg("id"));
  if (!Number.isInteger(id)) throw new Error("--id 必填，例如 --id 3");
  const row = await prisma.apiToken.findUnique({ where: { id }, select: { id: true, name: true, revokedAt: true } });
  if (!row) throw new Error(`令牌不存在：#${id}`);
  if (row.revokedAt) {
    console.log(`令牌 #${id} 已经是吊销状态`);
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        action: "update",
        entityType: "api_token",
        entityId: BigInt(id),
        afterJson: { revoked: true },
        ip: "local-script",
      },
    });
  });
  console.log(`已吊销令牌 #${id}（${row.name}）——立即失效`);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "create") await create();
  else if (cmd === "list") await list();
  else if (cmd === "revoke") await revoke();
  else {
    console.log("用法：");
    console.log('  npx tsx scripts/api-token.ts create --user admin --name "Agent 开单" [--scopes a,b] [--expires 90d]');
    console.log("  npx tsx scripts/api-token.ts list");
    console.log("  npx tsx scripts/api-token.ts revoke --id 3");
    process.exitCode = 2;
  }
}

main()
  .catch((e) => {
    console.error(`失败：${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
