FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.0.8 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY examples ./examples
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @connectors/whatsapp-service... run build
# `pnpm prune --prod` and the `pnpm install --prod --frozen-lockfile` fallback both abort
# under pnpm 11 with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY (no TTY in a Docker build
# layer to confirm purging node_modules); pnpm's own error message names CI=true as the fix.
RUN CI=true pnpm install --prod --frozen-lockfile

FROM node:22-alpine AS runtime
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 HOST=0.0.0.0
RUN mkdir -p /data && chown -R app:app /data
USER app
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "apps/whatsapp-service/dist/index.js"]
