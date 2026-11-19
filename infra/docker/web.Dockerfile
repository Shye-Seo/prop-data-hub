# syntax=docker/dockerfile:1
# 웹 이미지: 정적 빌드 후 nginx로 서빙한다. GitHub Pages와 같은 정적 산출물(docs/)을 만든다.
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/collector/package.json apps/collector/
RUN pnpm install --frozen-lockfile --filter @prop/web...

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @prop/web build

FROM nginx:1.27-alpine
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/docs /usr/share/nginx/html
EXPOSE 80
