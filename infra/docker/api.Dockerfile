# syntax=docker/dockerfile:1
# API 이미지: pnpm 워크스페이스 설치 후 TypeScript를 tsx로 직접 실행한다.
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/collector/package.json apps/collector/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @prop/api...

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY infra infra

ENV NODE_ENV=production
EXPOSE 8080
CMD ["pnpm", "--filter", "@prop/api", "start"]
