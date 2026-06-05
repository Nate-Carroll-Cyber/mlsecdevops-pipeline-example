# Sam Spade CTF service.
# Standalone backend for the /v1/ctf/sam-spade/* gameplay surface. Builds only
# backend-shared + services/sam-spade — no analyst-console SSR, no gateway tree.
FROM node:22.14.0-alpine AS dependencies
WORKDIR /app
# Workspace package.jsons are required so npm ci can resolve the
# @counter-spy/* workspaces declared in the root package.json.
COPY package.json package-lock.json ./
COPY packages/backend-shared/package.json ./packages/backend-shared/package.json
COPY services/gateway/package.json ./services/gateway/package.json
COPY services/sam-spade/package.json ./services/sam-spade/package.json
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json ./
COPY packages ./packages
COPY services/sam-spade ./services/sam-spade
# Build backend-shared first (services/sam-spade depends on its emitted .d.ts
# via TS project references), then the sam-spade workspace.
RUN npm run build --workspace=@counter-spy/backend-shared && \
    npm run build --workspace=@counter-spy/sam-spade

FROM node:22.14.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Production-only deps. The workspace package.jsons re-create the
# node_modules/@counter-spy/* symlinks; the actual backend-shared/dist and
# sam-spade/dist are copied below.
COPY package.json package-lock.json ./
COPY packages/backend-shared/package.json ./packages/backend-shared/package.json
COPY services/gateway/package.json ./services/gateway/package.json
COPY services/sam-spade/package.json ./services/sam-spade/package.json
RUN npm ci --omit=dev
COPY --from=build /app/packages/backend-shared/dist ./packages/backend-shared/dist
COPY --from=build /app/services/sam-spade/dist ./services/sam-spade/dist
RUN mkdir -p /app/data && chown -R node:node /app/data
# Health endpoint for Docker/ECS health checks.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:18120/healthz || exit 1
EXPOSE 18120
USER node
CMD ["node", "services/sam-spade/dist/server.js"]
