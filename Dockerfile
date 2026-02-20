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
    tini git curl sudo gnupg apt-transport-https ca-certificates ffmpeg sqlite3 \
    build-essential pkg-config iproute2 net-tools \
    # Playwright/Chromium system dependencies
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libdbus-1-3 libxkbcommon0 libatspi2.0-0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libwayland-client0 \
    && rm -rf /var/lib/apt/lists/*

# Desktop environment (conditionally started at runtime via ENABLE_DESKTOP)
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb xfce4 xfce4-terminal dbus-x11 x11vnc x11-utils \
    xdg-utils fonts-noto-color-emoji fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (gh)
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Install Go
ENV GOLANG_VERSION=1.24.0
RUN curl -fsSL "https://go.dev/dl/go${GOLANG_VERSION}.linux-$(dpkg --print-architecture).tar.gz" \
    | tar xz -C /usr/local \
    && ln -s /usr/local/go/bin/go /usr/local/bin/go \
    && ln -s /usr/local/go/bin/gofmt /usr/local/bin/gofmt

# Install Rust via rustup (shared location so all users can access it)
ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --profile minimal --no-modify-path \
    && chmod -R a+rX /usr/local/rustup /usr/local/cargo
ENV PATH="/usr/local/cargo/bin:$PATH"

# Install Python 3 with pip and venv
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Install Java (OpenJDK headless)
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

# Install Ruby
RUN apt-get update && apt-get install -y --no-install-recommends \
    ruby-full \
    && rm -rf /var/lib/apt/lists/*

# Install coding agents (OpenCode, Claude Code, Codex)
RUN npm install -g opencode-ai@latest
RUN npm install -g @anthropic-ai/claude-code@latest
RUN npm install -g @openai/codex@latest

# Install puppeteer globally so coding agents can import it from any workspace.
# Skip bundled Chromium download — we reuse Playwright's Chromium via PUPPETEER_EXECUTABLE_PATH.
RUN PUPPETEER_SKIP_DOWNLOAD=true npm install -g puppeteer

# Create non-root user with configurable UID/GID
ARG OTTERBOT_UID=1000
ARG OTTERBOT_GID=1000
ENV OTTERBOT_UID=${OTTERBOT_UID}
ENV OTTERBOT_GID=${OTTERBOT_GID}
RUN (getent group ${OTTERBOT_GID} || groupadd -g ${OTTERBOT_GID} otterbot) \
    && useradd -u ${OTTERBOT_UID} -g ${OTTERBOT_GID} -m otterbot 2>/dev/null \
    || useradd -u ${OTTERBOT_UID} -g ${OTTERBOT_GID} -m -o otterbot

# Sudoers configuration is handled at runtime in entrypoint.sh (SUDO_MODE env var)

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
COPY --from=build /app/assets ./assets

# Install Playwright Chromium browser (headless, for agent web browsing)
# Use a fixed path so both root (build) and otterbot (runtime) can find it
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN node packages/server/node_modules/playwright/cli.js install chromium

# Make Playwright's Chromium available as the system default browser.
# Wrapper script passes --no-sandbox (required in containers).
RUN CHROME_BIN=$(find /opt/playwright -name chrome -type f -path '*/chrome-linux*/chrome' | head -1) \
    && printf '#!/bin/sh\nexec "%s" --no-sandbox --disable-dev-shm-usage --user-data-dir=/tmp/otterbot-desktop-browser "$@"\n' "$CHROME_BIN" \
       > /usr/local/bin/chromium-browser \
    && chmod +x /usr/local/bin/chromium-browser \
    && mkdir -p /usr/share/applications \
    && printf '[Desktop Entry]\nName=Chromium\nExec=chromium-browser %%U\nType=Application\nCategories=Network;WebBrowser;\nMimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;\n' \
       > /usr/share/applications/chromium-browser.desktop \
    && update-alternatives --install /usr/bin/x-www-browser x-www-browser /usr/local/bin/chromium-browser 200 \
    && update-alternatives --install /usr/bin/gnome-www-browser gnome-www-browser /usr/local/bin/chromium-browser 200

# Download noVNC ES module source (native ESM — served as static files for the web viewer)
# Both core/ and vendor/ are needed because core/inflator.js imports ../vendor/pako/
RUN curl -fsSL https://github.com/novnc/noVNC/archive/refs/tags/v1.5.0.tar.gz | tar xz -C /tmp \
    && mkdir -p /app/novnc \
    && mv /tmp/noVNC-1.5.0/core /app/novnc/core \
    && mv /tmp/noVNC-1.5.0/vendor /app/novnc/vendor \
    && rm -rf /tmp/noVNC-1.5.0 \
    && ls -la /app/novnc/core/rfb.js

# Create data directories (use numeric UID:GID since group name may differ)
RUN mkdir -p /otterbot/config /otterbot/data /otterbot/projects /otterbot/logs /otterbot/home \
    && chown -R ${OTTERBOT_UID}:${OTTERBOT_GID} /otterbot /app

# Entrypoint script — runs as root, drops to otterbot user via setpriv
COPY --chmod=755 <<'EOF' /app/entrypoint.sh
#!/bin/sh
set -e

PUID="${OTTERBOT_UID:-1000}"
PGID="${OTTERBOT_GID:-1000}"

# Update user/group if runtime UID/GID differs from build-time
CURRENT_UID=$(id -u otterbot 2>/dev/null || echo "")
CURRENT_GID=$(id -g otterbot 2>/dev/null || echo "")

if [ -n "$CURRENT_UID" ] && [ "$CURRENT_GID" != "$PGID" ]; then
  groupmod -o -g "$PGID" otterbot 2>/dev/null || true
fi
if [ -n "$CURRENT_UID" ] && [ "$CURRENT_UID" != "$PUID" ]; then
  usermod -o -u "$PUID" otterbot 2>/dev/null || true
fi

# Configure sudo policy (user-selectable)
if [ "${SUDO_MODE}" = "full" ]; then
  echo "otterbot ALL=(root) NOPASSWD: ALL" > /etc/sudoers.d/otterbot
else
  echo "otterbot ALL=(root) NOPASSWD: /usr/bin/apt-get, /usr/local/bin/npm, /usr/bin/tee, /usr/bin/gpg, /usr/bin/install" > /etc/sudoers.d/otterbot
fi
chmod 0440 /etc/sudoers.d/otterbot

# Ensure data directories exist (they may be empty bind mounts)
mkdir -p /otterbot/config /otterbot/data /otterbot/home/.ssh \
         /otterbot/logs /otterbot/projects /otterbot/tools

# Fix ownership
chown -R "${PUID}:${PGID}" /otterbot

# Strict SSH permissions
chmod 700 /otterbot/home/.ssh
find /otterbot/home/.ssh -type f -exec chmod 600 {} + 2>/dev/null || true

# ── Create Python venv (persists on bind-mounted volume) ─────────────
if [ ! -f /otterbot/home/.venv/bin/activate ]; then
  echo "[otterbot] Creating Python venv..."
  python3 -m venv /otterbot/home/.venv
  chown -R "${PUID}:${PGID}" /otterbot/home/.venv
fi

# ── Install packages from manifest ──────────────────────────────────
# The COO agent (or user) writes /otterbot/config/packages.json with
# { "repos": [...], "apt": [{"name":"..."}], "npm": [{"name":"...","version":"..."}] }
MANIFEST="/otterbot/config/packages.json"
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
      echo "[otterbot] Adding repo: $REPO_NAME"
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
    echo "[otterbot] Installing apt packages: $APT_PKGS"
    apt-get update && apt-get install -y --no-install-recommends $APT_PKGS
  fi

  # Install npm packages (globally — persists on bind mount via NPM_CONFIG_PREFIX)
  NPM_PKGS=$(node -e "
    const m = JSON.parse(require('fs').readFileSync('$MANIFEST','utf-8'));
    if (m.npm && m.npm.length) console.log(m.npm.map(p => p.version ? p.name+'@'+p.version : p.name).join(' '));
  " 2>/dev/null || true)
  if [ -n "$NPM_PKGS" ]; then
    echo "[otterbot] Installing npm packages: $NPM_PKGS"
    npm install -g $NPM_PKGS
  fi
fi

# ── Run custom bootstrap script ─────────────────────────────────────
# For anything not covered by packages.json (custom setup, config, etc.)
if [ -f /otterbot/config/bootstrap.sh ]; then
  echo "[otterbot] Running bootstrap script..."
  sh /otterbot/config/bootstrap.sh
fi

# ── Conditional desktop startup ────────────────────────────────────
if [ "${ENABLE_DESKTOP}" = "true" ]; then
  echo "[otterbot] Starting desktop environment..."
  export DISPLAY=:99

  # Create XDG_RUNTIME_DIR for the otterbot user
  XDG_DIR="/run/user/${PUID}"
  mkdir -p "$XDG_DIR"
  chown "${PUID}:${PGID}" "$XDG_DIR"
  chmod 700 "$XDG_DIR"
  export XDG_RUNTIME_DIR="$XDG_DIR"

  # Start Xvfb
  Xvfb :99 -screen 0 "${DESKTOP_RESOLUTION:-1280x720x24}" -ac +extension GLX +render -noreset &
  XVFB_PID=$!

  # Wait for X to be ready (max 30s)
  TRIES=0
  while ! xdpyinfo -display :99 >/dev/null 2>&1; do
    TRIES=$((TRIES + 1))
    if [ "$TRIES" -ge 60 ]; then
      echo "[otterbot] ERROR: Xvfb failed to start after 30s"
      break
    fi
    sleep 0.5
  done
  echo "[otterbot] Xvfb ready on :99"

  # Start dbus (needed by XFCE)
  eval "$(setpriv --reuid="${PUID}" --regid="${PGID}" --init-groups dbus-launch --sh-syntax 2>/dev/null || true)"
  export DBUS_SESSION_BUS_ADDRESS

  # Start XFCE4 session as the otterbot user
  setpriv --reuid="${PUID}" --regid="${PGID}" --init-groups \
    env DISPLAY=:99 DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" XDG_RUNTIME_DIR="$XDG_DIR" \
    startxfce4 &
  echo "[otterbot] XFCE4 session starting..."
  sleep 2

  # Start x11vnc bound to localhost only
  setpriv --reuid="${PUID}" --regid="${PGID}" --init-groups \
    x11vnc -display :99 -localhost -nopw -forever -shared -noshm -rfbport "${VNC_PORT:-5900}" &
  echo "[otterbot] x11vnc started on localhost:${VNC_PORT:-5900}"
else
  export DISPLAY=""
fi

# Clean up apt cache
rm -rf /var/lib/apt/lists/*

# Drop privileges and start the app
exec setpriv --reuid="${PUID}" --regid="${PGID}" --init-groups \
  env DISPLAY="$DISPLAY" DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-}" XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-}" \
  node packages/server/dist/index.js
EOF

ENV NODE_ENV=production
ENV PORT=62626
ENV HOST=0.0.0.0
ENV DATABASE_URL=file:/otterbot/data/otterbot.db
ENV WORKSPACE_ROOT=/otterbot
ENV HOME=/otterbot/home

# Runtime tools installed via bootstrap.sh persist on the bind-mounted volume
ENV NPM_CONFIG_PREFIX=/otterbot/tools
ENV PATH="/otterbot/tools/bin:$PATH"

ENV GOPATH=/otterbot/home/go
ENV PATH="/otterbot/home/go/bin:$PATH"
ENV VIRTUAL_ENV=/otterbot/home/.venv
ENV PATH="/otterbot/home/.venv/bin:$PATH"
ENV BROWSER=/usr/local/bin/chromium-browser
ENV PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chromium-browser
ENV ENABLE_DESKTOP=true
ENV DESKTOP_RESOLUTION=1280x720x24
ENV VNC_PORT=5900
ENV SUDO_MODE=restricted

EXPOSE 62626

ENTRYPOINT ["tini", "--"]
CMD ["/app/entrypoint.sh"]
