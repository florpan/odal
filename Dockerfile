# syntax=docker/dockerfile:1
# Odal: build the client with Vite, then run the Bun game server which serves it.
#
#   docker build -t registry.berge.tech/lab/odal:latest .
#   docker run -p 3000:3000 registry.berge.tech/lab/odal:latest
#
# The server runs TypeScript directly under Bun; only the client is compiled.

ARG BUN_VERSION=1.3
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app

# Install with only the manifests first so the dependency layer is cached.
COPY package.json bun.lock ./
COPY packages/engine/package.json packages/engine/
COPY packages/content/package.json packages/content/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# ---------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock ./
COPY packages/engine/package.json packages/engine/
COPY packages/content/package.json packages/content/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN bun install --frozen-lockfile --production

COPY packages/engine/src packages/engine/src
COPY packages/content/src packages/content/src
COPY packages/content/default packages/content/default
COPY packages/content/schema packages/content/schema
COPY packages/server/src packages/server/src
COPY --from=build /app/packages/client/dist packages/client/dist

USER bun
EXPOSE 3000
ENV PORT=3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD bun -e "fetch('http://localhost:3000/').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["bun", "packages/server/src/index.ts"]
