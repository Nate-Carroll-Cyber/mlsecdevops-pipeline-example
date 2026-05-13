# Gateway multi-stage build.
# The gateway serves both the /v1 API (compiled from backend/) and the
# server-rendered analyst console (Vite client + SSR bundles built from src/).
# So this image produces backend/dist + dist/client + dist/server and keeps only
# the production deps + those artifacts in the runtime stage. The sam-spade-service
# now ships its own image (services/sam-spade/Dockerfile).
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
# Vite bakes VITE_* env into the client bundle at build time;
# VITE_BACKEND_BEARER_TOKEN must equal the gateway's runtime INTERCEPT_BEARER_TOKEN.
ARG VITE_BACKEND_BEARER_TOKEN=""
ARG VITE_API_BASE_URL=""
ARG VITE_CTF_FRONTEND_URL=""
ARG VITE_OTEL_EXPORTER_OTLP_ENDPOINT=""
ENV VITE_BACKEND_BEARER_TOKEN=$VITE_BACKEND_BEARER_TOKEN \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_CTF_FRONTEND_URL=$VITE_CTF_FRONTEND_URL \
    VITE_OTEL_EXPORTER_OTLP_ENDPOINT=$VITE_OTEL_EXPORTER_OTLP_ENDPOINT
# Compile the backend TS output and build the analyst-console bundles.
# backend:build runs shared:build first so packages/backend-shared/dist exists
# before tsc -p backend/tsconfig.json reads its referenced project.
COPY tsconfig.json vite.config.ts index.html firebase-applet-config.json ./
COPY src ./src
COPY public ./public
COPY backend ./backend
COPY packages ./packages
RUN npm run backend:build && npm run build

FROM node:22.14.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Install only production dependencies in the final image. react/react-dom and the
# other console runtime deps live in "dependencies", so the externalized imports in
# dist/server/entry-server.js resolve at runtime. The workspace package.jsons are
# needed so npm ci re-creates the node_modules/@counter-spy/* symlinks; the actual
# backend-shared/dist is copied below.
COPY package.json package-lock.json ./
COPY packages/backend-shared/package.json ./packages/backend-shared/package.json
COPY services/gateway/package.json ./services/gateway/package.json
COPY services/sam-spade/package.json ./services/sam-spade/package.json
RUN npm ci --omit=dev && apk add --no-cache su-exec
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/dist ./dist
COPY --from=build /app/packages/backend-shared/dist ./packages/backend-shared/dist
COPY seeds ./seeds
COPY backend/docker-entrypoint.sh /usr/local/bin/counter-spy-backend-entrypoint
RUN chmod +x /usr/local/bin/counter-spy-backend-entrypoint
# Expose a simple health endpoint for Docker/ECS style health checks.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
EXPOSE 8080
# Start the compiled backend server.
ENTRYPOINT ["counter-spy-backend-entrypoint"]
CMD ["node", "backend/dist/server.js"]
