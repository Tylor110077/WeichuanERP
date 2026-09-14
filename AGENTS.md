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

## Zod 表单数字：不要用「preprocess 外套 optional」

`z.coerce.number()` 把空串当 0、把 `undefined` 当 `NaN`。而
`.optional()` 加在 `z.preprocess()` **外面**时，Zod 判断的是原始输入（空串 = 有值），
仍会走进内层 schema，于是 `undefined` 被 coerce 成 `NaN`，用户看到的是英文的
`Invalid input: expected number, received NaN`。

统一用 `src/lib/form-number.ts`：

- `optionalNumber({ invalid, min, ... })`：留空 → `undefined`（如销售开单的「用库存」，
  留空＝尽量用库存，不能被当成 0）；`.optional()` 在内层。
- `requiredNumber({ invalid, min, ... })`：留空/非法都给同一个中文提示。
- `firstIssueMessage(error, labels)`：把报错渲染成「第 1 行「数量」：请填写数量」。

新增数字字段时照抄这三个函数，别再手写 `z.coerce.number()`；
`tests/form-number.test.ts` 覆盖了这些边界。

## Zod 布尔：不要用 `z.coerce.boolean()`

它是 JS 的 `Boolean()`——**非空字符串一律为 true**，于是命令行里的
`--enabled false` 会被当成"启用"，`--allow-duplicate=false` 会被当成"允许"。
这类 bug 表里不一：命令看起来跑了、日志也对，只有结果悄悄反了。

统一用 `src/lib/form-bool.ts` 的 `zBoolean()`：`false/0/no/off/否` 认作假，
`true/1/yes/on/是` 认作真，**认不出的输入直接报错**而不是猜一个值。
`tests/form-bool.test.ts` 覆盖了这些边界。

（CLI 侧 `cli/src/index.ts` 会把 `--x true|false` 提前转成真布尔，
但服务端仍要能自己挡住字符串 —— 端点是可以被 curl 直接打的。）
