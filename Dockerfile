# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder

WORKDIR /app

ENV CI=true

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json tsconfig.base.json ./
COPY artifacts/api-server/package.json artifacts/api-server/package.json
COPY artifacts/web/package.json artifacts/web/package.json
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/package.json
COPY lib/api-client-react/package.json lib/api-client-react/package.json
COPY lib/api-spec/package.json lib/api-spec/package.json
COPY lib/api-zod/package.json lib/api-zod/package.json
COPY lib/db/package.json lib/db/package.json
COPY lib/ui/package.json lib/ui/package.json
COPY artifacts/landing-next/package.json artifacts/landing-next/package.json
COPY scripts/package.json scripts/package.json

RUN corepack pnpm install --frozen-lockfile

COPY artifacts ./artifacts
COPY attached_assets ./attached_assets
COPY lib ./lib
COPY scripts ./scripts

RUN corepack pnpm run typecheck:libs
RUN corepack pnpm --filter @workspace/api-server run typecheck
RUN corepack pnpm --filter @workspace/web run typecheck
RUN corepack pnpm --filter @workspace/api-server run build
RUN BASE_PATH=/ corepack pnpm --filter @workspace/web run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV SERVE_STATIC=true

COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /app/artifacts/web/dist/public ./artifacts/web/dist/public

USER node

EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
