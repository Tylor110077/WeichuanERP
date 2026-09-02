# 维川进销存（WeichuanERP）

企业进销存管理系统（进货 / 售卖 / 库存 / 往来 / 报表），全新自研，适用于 5~50 人使用。
需求与设计见 [docs/进销存系统-需求与设计文档.md](docs/进销存系统-需求与设计文档.md)。

## 技术栈

- Next.js 16（App Router）+ TypeScript + Tailwind CSS v4
- Prisma 6 + MySQL 8+
- 认证：argon2id 密码哈希、服务端会话（HttpOnly Cookie，8h，登出即失效）、登录失败锁定

## 本地开发

```bash
npm install
npm run db:start        # 启动项目本地 MySQL（端口 3307，数据目录 .mysql/，独立于系统 MySQL）
npm run db:migrate      # 应用迁移
npm run seed            # 创建管理员 admin（密码见 .env 的 ADMIN_INIT_PASSWORD，默认 Admin@12345）
npm run dev             # http://127.0.0.1:3000
npm run db:stop         # 停止本地 MySQL
```

环境变量参考 `.env.example`；本地 `.env` 不入库。

## 里程碑

M1 已交付：项目骨架、数据库建模（18+ 张表，见 prisma/schema.prisma）、登录认证、用户管理、审计日志内核。
后续 M2~M6 见文档第 10 章。

> 开发中细节决策与待评审问题见 [docs/细节评审.md](docs/细节评审.md)。
