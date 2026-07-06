FROM node:24-bookworm AS builder

WORKDIR /workspace

COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

COPY apps/app-server/package.json apps/app-server/tsconfig.json apps/app-server/vitest.config.ts ./apps/app-server/
COPY apps/app-server/src ./apps/app-server/src

COPY packages/config/package.json packages/config/tsconfig.json ./packages/config/
COPY packages/config/src ./packages/config/src

COPY packages/shared-contracts/package.json packages/shared-contracts/tsconfig.json ./packages/shared-contracts/
COPY packages/shared-contracts/src ./packages/shared-contracts/src

COPY packages/persistence/package.json packages/persistence/tsconfig.json ./packages/persistence/
COPY packages/persistence/src ./packages/persistence/src

COPY packages/observability/package.json packages/observability/tsconfig.json ./packages/observability/
COPY packages/observability/src ./packages/observability/src

COPY packages/trading-core/package.json packages/trading-core/tsconfig.json ./packages/trading-core/
COPY packages/trading-core/src ./packages/trading-core/src

COPY mt4_ea ./mt4_ea

RUN corepack enable && pnpm install --frozen-lockfile && pnpm --filter app-server build

FROM node:24-bookworm-slim AS runtime

WORKDIR /workspace

COPY --from=builder /workspace /workspace

EXPOSE 8880

CMD ["/bin/sh", "-lc", "corepack enable && pnpm --filter app-server start"]
