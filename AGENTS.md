<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 开发注意事项（本项目踩过的坑）

## 改了 Prisma schema 必须重启 dev

新增/修改 `prisma/schema.prisma` 字段后，即使 `npx prisma migrate deploy` 与
`npx prisma generate` 都成功，**正在运行的 `next dev` 进程仍持有旧的 Prisma Client**。
症状：运行时抛 `Unknown argument \`xxx\``，或该字段读出 `undefined`（页面显示为空）。

处理：改完 schema 后重启 dev：

```bash
pkill -f "next dev" && npm run dev
```

生产镜像在构建期执行 `prisma generate`，不存在该问题。

## 运行 dev 时不要再跑 build

`npm run build` 与 `npm run dev` 共用 `.next` 目录，同时运行会互踩，
表现为客户端 chunk 加载失败、hydration 静默失败等难以定位的现象。

## 从 "use client" 模块导入常量到服务端组件要小心

服务端组件从带 `"use client"` 的模块 import 常量，拿到的是客户端引用而非其值
（例如 `SIDEBAR_COOKIE`），会导致服务端判断恒为假。共享常量请放在
`src/lib/*.ts` 这类非 client 模块中。
