# Backend multi-stage build.
# First install deps, then compile TypeScript, then copy only what the runtime needs.
FROM node:22.14.0-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
# Build just the backend TypeScript output.
COPY tsconfig.json ./tsconfig.json
COPY backend ./backend
RUN npm run backend:build

FROM node:22.14.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Install only production dependencies in the final image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && apk add --no-cache su-exec
COPY --from=build /app/backend/dist ./backend/dist
COPY seeds ./seeds
COPY backend/docker-entrypoint.sh /usr/local/bin/counter-spy-backend-entrypoint
RUN chmod +x /usr/local/bin/counter-spy-backend-entrypoint
# Expose a simple health endpoint for Docker/ECS style health checks.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
EXPOSE 8080
# Start the compiled backend server.
ENTRYPOINT ["counter-spy-backend-entrypoint"]
CMD ["node", "backend/dist/server.js"]
