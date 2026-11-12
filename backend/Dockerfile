# =========================
# Dependencies
# =========================
FROM node:22-bookworm-slim AS deps

WORKDIR /app

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    wget \
    openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json

RUN npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 --no-audit --no-fund


# =========================
# Builder
# =========================
FROM deps AS builder

COPY backend ./backend

WORKDIR /app/backend

RUN npx prisma generate

RUN npm run build


# =========================
# Production
# =========================
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y \
    openssl \
    wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules

# ADD THESE
COPY --from=builder /app/backend/package.json ./package.json
COPY --from=builder /app/backend/prisma ./prisma

# Compiled backend
COPY --from=builder /app/backend/dist ./dist

# Prisma Client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 5000

# Run as the unprivileged "node" user (SECURITY_FINDINGS INFRA-2). Uploads is the only
# folder the app writes to. Existing servers: hand the old volume over once with
#   docker compose run --rm -u root backend chown -R node:node /app/uploads
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node

# Apply pending migrations, then start. Safe to run on every start.
# `exec` makes Node replace the shell, so Docker's SIGTERM reaches the app and it can
# finish in-flight requests before stopping (graceful shutdown).
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/index.js"]