# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-bookworm AS builder

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package.json package-lock.json ./

RUN npm ci

# Copy source code and build
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS production

WORKDIR /app

# Copy package files and install production dependencies only
COPY package.json package-lock.json ./

RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R appuser:appuser /app

USER appuser

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3100/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
