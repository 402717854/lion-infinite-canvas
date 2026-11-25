# 构建 canvas-api 产物。构建上下文是仓库根目录：运行时还需要 web 下的 permissions.json。
FROM node:22-alpine AS build

WORKDIR /app/canvas-api
COPY canvas-api/package.json canvas-api/package-lock.json ./
RUN npm ci --ignore-scripts
COPY canvas-api/tsconfig.json ./
COPY canvas-api/src ./src
RUN npm run build

# 运行镜像：只保留生产依赖、编译产物和建表 SQL。
FROM node:22-alpine

WORKDIR /app/canvas-api
ENV NODE_ENV=production

COPY canvas-api/package.json canvas-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/canvas-api/dist ./dist
# tsc 不复制 .sql，migrate 从 src/schema.sql 读取建表语句。
COPY canvas-api/src/schema.sql ./src/schema.sql
# permissions.json 是前后端共用的权限定义，权限模块按仓库目录结构读取。
COPY web/src/constant/permissions.json /app/web/src/constant/permissions.json

RUN mkdir -p /data/uploads && chown -R node:node /data/uploads
USER node

ENV PORT=8787 \
    DATA_DIR=/data/uploads
EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 \
    CMD node -e "fetch('http://127.0.0.1:8787/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
