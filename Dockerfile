# 维川进销存 生产镜像（文档 8.4：单台云服务器 + Docker + Nginx）
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
# 低内存服务器（2G 左右）构建 Next.js 时需限制 V8 堆，避免 OOM/swap 抖动
ARG NODE_BUILD_MEM=512
ENV NODE_OPTIONS=--max-old-space-size=${NODE_BUILD_MEM}
# 生成 Prisma Client（构建期不需要数据库连接）
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
# 全量 node_modules：standalone 裁剪版不含 prisma/tsx CLI，
# 部署指南要求 `docker compose exec app npx prisma migrate deploy` / `npx tsx prisma/seed.ts`
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
USER node
CMD ["node", "server.js"]
