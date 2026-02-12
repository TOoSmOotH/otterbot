FROM node:22 AS base

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
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini git curl sudo gnupg apt-transport-https ca-certificates ffmpeg \
    # Playwright/Chromium system dependencies
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libdbus-1-3 libxkbcommon0 libatspi2.0-0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libwayland-client0 \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (gh)
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user with configurable UID/GID
ARG SMOOTHBOT_UID=1000
ARG SMOOTHBOT_GID=1000
ENV SMOOTHBOT_UID=${SMOOTHBOT_UID}
ENV SMOOTHBOT_GID=${SMOOTHBOT_GID}
RUN (getent group ${SMOOTHBOT_GID} || groupadd -g ${SMOOTHBOT_GID} smoothbot) \
    && useradd -u ${SMOOTHBOT_UID} -g ${SMOOTHBOT_GID} -m smoothbot 2>/dev/null \
    || useradd -u ${SMOOTHBOT_UID} -g ${SMOOTHBOT_GID} -m -o smoothbot

# Allow smoothbot user to manage packages and repos without a password
# - apt-get: install/remove packages
# - npm: global installs
# - tee: write repo source files to /etc/apt/sources.list.d/
# - gpg: import repository signing keys
# - install: create directories for keyrings (used by apt key management)
RUN echo "smoothbot ALL=(root) NOPASSWD: /usr/bin/apt-get, /usr/local/bin/npm, /usr/bin/tee, /usr/bin/gpg, /usr/bin/install" > /etc/sudoers.d/smoothbot \
    && chmod 0440 /etc/sudoers.d/smoothbot

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

# Install Playwright Chromium browser (headless, for agent web browsing)
RUN node packages/server/node_modules/playwright/cli.js install chromium

# Create data directories (use numeric UID:GID since group name may differ)
RUN mkdir -p /smoothbot/config /smoothbot/data /smoothbot/projects /smoothbot/logs /smoothbot/home \
    && chown -R ${SMOOTHBOT_UID}:${SMOOTHBOT_GID} /smoothbot /app

# Entrypoint script — runs as root, drops to smoothbot user via setpriv
COPY --chmod=755 <<'EOF' /app/entrypoint.sh
#!/bin/sh
set -e

PUID="${SMOOTHBOT_UID:-1000}"
PGID="${SMOOTHBOT_GID:-1000}"

# Ensure data directories exist (they may be empty bind mounts)
mkdir -p /smoothbot/config /smoothbot/data /smoothbot/home/.ssh \
         /smoothbot/logs /smoothbot/projects /smoothbot/tools

# Fix ownership
chown -R "${PUID}:${PGID}" /smoothbot

# Strict SSH permissions
chmod 700 /smoothbot/home/.ssh
find /smoothbot/home/.ssh -type f -exec chmod 600 {} + 2>/dev/null || true

# ── Install packages from manifest ──────────────────────────────────
# The COO agent (or user) writes /smoothbot/config/packages.json with
# { "repos": [...], "apt": [{"name":"..."}], "npm": [{"name":"...","version":"..."}] }
MANIFEST="/smoothbot/config/packages.json"
if [ -f "$MANIFEST" ]; then
  # Restore apt repositories (GPG keys + source lists)
  node -e "
    const m = JSON.parse(require('fs').readFileSync('$MANIFEST','utf-8'));
    if (m.repos && m.repos.length) {
      for (const r of m.repos) {
        console.log(JSON.stringify(r));
      }
    }
  " 2>/dev/null | while IFS= read -r repo; do
    REPO_NAME=$(echo "$repo" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).name)")
    REPO_KEY_URL=$(echo "$repo" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).keyUrl)")
    REPO_KEY_PATH=$(echo "$repo" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).keyPath)")
    REPO_SOURCE=$(echo "$repo" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')).source)")
    if [ ! -f "/etc/apt/sources.list.d/${REPO_NAME}.list" ]; then
      echo "[smoothbot] Adding repo: $REPO_NAME"
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL "$REPO_KEY_URL" | gpg --dearmor -o "$REPO_KEY_PATH" 2>/dev/null || true
      echo "$REPO_SOURCE" > "/etc/apt/sources.list.d/${REPO_NAME}.list"
    fi
  done

  # Install apt packages
  APT_PKGS=$(node -e "
    const m = JSON.parse(require('fs').readFileSync('$MANIFEST','utf-8'));
    if (m.apt && m.apt.length) console.log(m.apt.map(p=>p.name).join(' '));
  " 2>/dev/null || true)
  if [ -n "$APT_PKGS" ]; then
    echo "[smoothbot] Installing apt packages: $APT_PKGS"
    apt-get update && apt-get install -y --no-install-recommends $APT_PKGS
  fi

  # Install npm packages (globally — persists on bind mount via NPM_CONFIG_PREFIX)
  NPM_PKGS=$(node -e "
    const m = JSON.parse(require('fs').readFileSync('$MANIFEST','utf-8'));
    if (m.npm && m.npm.length) console.log(m.npm.map(p => p.version ? p.name+'@'+p.version : p.name).join(' '));
  " 2>/dev/null || true)
  if [ -n "$NPM_PKGS" ]; then
    echo "[smoothbot] Installing npm packages: $NPM_PKGS"
    npm install -g $NPM_PKGS
  fi
fi

# ── Run custom bootstrap script ─────────────────────────────────────
# For anything not covered by packages.json (custom setup, config, etc.)
if [ -f /smoothbot/config/bootstrap.sh ]; then
  echo "[smoothbot] Running bootstrap script..."
  sh /smoothbot/config/bootstrap.sh
fi

# Clean up apt cache
rm -rf /var/lib/apt/lists/*

# Drop privileges and start the app
exec setpriv --reuid="${PUID}" --regid="${PGID}" --init-groups \
  node packages/server/dist/index.js
EOF

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_URL=file:/smoothbot/data/smoothbot.db
ENV WORKSPACE_ROOT=/smoothbot
ENV HOME=/smoothbot/home

# Runtime tools installed via bootstrap.sh persist on the bind-mounted volume
ENV NPM_CONFIG_PREFIX=/smoothbot/tools
ENV PATH="/smoothbot/tools/bin:$PATH"

EXPOSE 3000

ENTRYPOINT ["tini", "--"]
CMD ["/app/entrypoint.sh"]
