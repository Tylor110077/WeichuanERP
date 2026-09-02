import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();

async function main() {
  const password = process.env.ADMIN_INIT_PASSWORD ?? "Admin@12345";
  const passwordHash = await hashPassword(password);

  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    // 已存在则不动（初始密码仅在首次创建时生效，改密走用户管理/个人中心）
    update: {},
    create: {
      username: "admin",
      displayName: "系统管理员",
      role: "admin",
      passwordHash,
    },
  });

  console.log(
    `管理员账号已就绪: ${admin.username} / ${admin.displayName}（角色：${admin.role}）`
  );
}

main()
  .catch((err) => {
    console.error("种子数据执行失败:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
