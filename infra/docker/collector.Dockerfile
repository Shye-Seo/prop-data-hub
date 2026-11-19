# syntax=docker/dockerfile:1
# 수집 워커 이미지. EventBridge Scheduler가 이 이미지를 RunTask로 실행한다.
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/collector/package.json apps/collector/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @prop/collector...

COPY packages/shared packages/shared
COPY apps/collector apps/collector
COPY infra infra

ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@prop/collector", "once"]
