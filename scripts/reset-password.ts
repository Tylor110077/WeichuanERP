/**
 * 管理员/用户密码重置（只在服务器侧离线执行，**不做成 HTTP 接口**）。
 *
 * 为什么是本地脚本：与 `scripts/api-token.ts` 同一个道理——重置密码等于"拿到某个账号"。
 * 做成接口就等于开了一个"忘密码就能改别人密码"的口子。能连库/能进容器的人本来就能改一切，
 * 所以这件事只在受信环境做。
 *
 * 用法：
 *   npx tsx scripts/reset-password.ts --user admin              # 生成随机强密码（打印一次）
 *   npx tsx scripts/reset-password.ts --user admin --stdin      # 从标准输入读新密码
 *   npx tsx scripts/reset-password.ts --user admin --dry-run    # 只看会做什么，不落库
 *
 * 故意**不支持 `--password <明文>`**：明文会进 shell 历史与进程列表。
 * 不指定就是随机生成；要自定义就走 `--stdin`。
 *
 * 重置会同时**踢掉该用户的全部登录会话**（旧密码可能已泄露，留着会话等于没重置），
 * 并写一条审计（只记"重置了谁的密码、踢了几个会话"，绝不记密码本身）。
 *
 * 生产上怎么跑（容器里已带 scripts/；旧镜像可用 docker compose run 挂载）：
 *   cd /opt/weichuan && docker compose exec -T app npx tsx scripts/reset-password.ts --user admin
 */
import { randomBytes } from "node:crypto";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 生成可读性尚可的随机密码：Base64URL 去掉易混字符，保证字母+数字混合（满足强度校验）。 */
function randomPassword(): string {
  for (;;) {
    const pw = randomBytes(12).toString("base64url").replace(/[-_]/g, (c) => (c === "-" ? "k" : "W"));
    if (!validatePasswordStrength(pw)) return pw;
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}

async function main() {
  if (process.argv.includes("--password")) {
    throw new Error(
      "不支持 --password（明文会进 shell 历史与进程列表）。" +
        "不指定参数即随机生成；要自定义请用 --stdin 从标准输入读。"
    );
  }
  const username = arg("user") ?? "admin";
  const dryRun = process.argv.includes("--dry-run");
  const fromStdin = process.argv.includes("--stdin");

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, role: true, displayName: true, status: true },
  });
  if (!user) {
    const all = await prisma.user.findMany({ select: { username: true }, orderBy: { id: "asc" } });
    throw new Error(
      `用户不存在：${username}\n现有账号：${all.map((u) => u.username).join(", ")}`
    );
  }

  const password = fromStdin ? await readStdin() : randomPassword();
  const weak = validatePasswordStrength(password);
  if (weak) throw new Error(`新密码不合规：${weak}`);

  const sessions = await prisma.session.count({ where: { userId: user.id } });
  console.log(`账号：${user.username}（${user.displayName}，${user.role}${user.status !== 1 ? "，已停用" : ""}）`);
  console.log(`将重置密码并踢掉 ${sessions} 个登录会话。`);
  if (dryRun) {
    console.log("（--dry-run：什么都没写。确认后去掉该参数再执行）");
    return;
  }

  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    const killed = await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "update",
        entityType: "user",
        entityId: BigInt(user.id),
        afterJson: { passwordReset: true, sessionsRevoked: killed.count },
        ip: "local-script",
      },
    });
  });

  console.log("");
  console.log("✅ 已重置。新密码（只显示这一次，请立即保存；登录后可在「个人中心」改掉）：");
  console.log(`  ${password}`);
  console.log("");
  console.log(`已踢掉 ${sessions} 个会话：该账号在所有设备上都需要用新密码重新登录。`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(`错误：${e instanceof Error ? e.message : e}`);
  await prisma.$disconnect();
  process.exit(1);
});
