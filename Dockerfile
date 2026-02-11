FROM node:22-slim AS base

RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/
RUN pnpm install --frozen-lockfile

# Build
FROM deps AS build
COPY . .
RUN pnpm build

# Production
FROM base AS production
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

# Create non-root user with configurable UID/GID
ARG SMOOTHBOT_UID=1000
ARG SMOOTHBOT_GID=1000
RUN (getent group ${SMOOTHBOT_GID} || groupadd -g ${SMOOTHBOT_GID} smoothbot) \
    && useradd -u ${SMOOTHBOT_UID} -g ${SMOOTHBOT_GID} -m smoothbot 2>/dev/null \
    || useradd -u ${SMOOTHBOT_UID} -g ${SMOOTHBOT_GID} -m -o smoothbot

WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/package.json ./packages/server/
COPY --from=build /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=build /app/packages/web/dist ./packages/web/dist
COPY --from=build /app/packages/web/package.json ./packages/web/

# Create data directories (use numeric UID:GID since group name may differ)
RUN mkdir -p /smoothbot/config /smoothbot/data /smoothbot/projects /smoothbot/logs \
    && chown -R ${SMOOTHBOT_UID}:${SMOOTHBOT_GID} /smoothbot /app

# Entrypoint script
COPY --chmod=755 <<'EOF' /app/entrypoint.sh
#!/bin/sh
# Ensure data directories exist (they may be empty bind mounts)
mkdir -p /smoothbot/config /smoothbot/data /smoothbot/projects /smoothbot/logs

# Run bootstrap if it exists
if [ -f /smoothbot/config/bootstrap.sh ]; then
  echo "Running bootstrap script..."
  sh /smoothbot/config/bootstrap.sh
fi
exec node packages/server/dist/index.js
EOF

USER ${SMOOTHBOT_UID}

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_URL=file:/smoothbot/data/smoothbot.db
ENV WORKSPACE_ROOT=/smoothbot

EXPOSE 3000

ENTRYPOINT ["tini", "--"]
CMD ["/app/entrypoint.sh"]
