# Build from the repo root: docker build -f apps/app-agent/Dockerfile -t gold-analysis-agent .
FROM node:20-bookworm AS builder

WORKDIR /workspace

COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

COPY apps/app-agent/package.json apps/app-agent/tsconfig.json apps/app-agent/vitest.config.ts ./apps/app-agent/
COPY apps/app-agent/src ./apps/app-agent/src

RUN corepack enable && pnpm install --frozen-lockfile && pnpm --filter app-agent build

FROM node:20-bookworm-slim AS production

WORKDIR /workspace

COPY --from=builder /workspace /workspace

# better-sqlite3 and accounts.json resolve relative to process.cwd(), which
# must stay the package directory (matching the pre-monorepo `cd agents && npm start`).
RUN groupadd -r appuser && useradd -r -g appuser -d /workspace -s /sbin/nologin appuser \
    && mkdir -p /workspace/apps/app-agent/data \
    && chown -R appuser:appuser /workspace/apps/app-agent

USER appuser
WORKDIR /workspace/apps/app-agent

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3100/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
