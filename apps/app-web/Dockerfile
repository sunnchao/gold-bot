# syntax=docker/dockerfile:1

# apps/app-web builds to a pure static export (next.config.ts: output "export"),
# so only the build stages need Node.js. The runtime stage ships nginx only -
# no Node runtime, no node_modules, no source - to keep the final image tiny.
#
# `turbo prune` carves out the minimal slice of this pnpm workspace needed for
# app-web (root manifests + this package, no unrelated app/package sources) so
# that unrelated monorepo changes don't bust the dependency-install cache layer.
#
# Build from the repo root: docker build -f apps/app-web/Dockerfile -t gold-bot-app-web .

FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate && npm install --global turbo@^2

FROM base AS pruner
COPY . .
RUN turbo prune app-web --docker

FROM base AS installer
COPY --from=pruner /workspace/out/json/ .
COPY --from=pruner /workspace/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY .npmrc ./
RUN --mount=type=cache,id=app-web-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=installer /workspace/ .
COPY --from=pruner /workspace/out/full/ .
RUN turbo run build --filter=app-web

FROM nginx:1.27-alpine AS runtime
COPY apps/app-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/apps/app-web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
