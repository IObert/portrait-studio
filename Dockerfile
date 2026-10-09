# syntax=docker/dockerfile:1.7
# One image for both processes (SPEC §3.2):
#   web:    node apps/web/server.js            (default CMD)
#   worker: node --import tsx worker/main.ts  (workdir /repo/apps/web)

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/print-agent/package.json apps/print-agent/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @portrait-studio/web...

FROM deps AS build
COPY apps/web apps/web
RUN pnpm --filter @portrait-studio/web build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# Web: the self-contained standalone server plus static assets.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
# Worker: sources and the full dependency tree (it runs TypeScript with tsx).
COPY --from=build --chown=node:node /repo/package.json /repo/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=build --chown=node:node /repo/apps/web/lib ./apps/web/lib
COPY --from=build --chown=node:node /repo/apps/web/worker ./apps/web/worker
COPY --from=build --chown=node:node /repo/apps/web/package.json /repo/apps/web/tsconfig.json ./apps/web/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
