#!/usr/bin/env bash
#
# Launch a local otterbot daemon for manual testing.
#
# Builds the workspace, then drives the daemon CLI against an isolated state
# directory (.otterbot-dev/ in the repo) so it never touches your real
# ~/.otterbot. This exercises the same `otterbot start/stop/...` flow that
# ships in the published package.
#
#   scripts/dev-daemon.sh [start|stop|restart|status|logs]   (default: start)
#
# Examples:
#   scripts/dev-daemon.sh start          # build + start on port 3001
#   PORT=4000 scripts/dev-daemon.sh start
#   scripts/dev-daemon.sh logs -f
#   scripts/dev-daemon.sh stop
#
# For hot-reload development (server + Vite HMR) use `pnpm dev` instead.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export OTTERBOT_HOME="$REPO_ROOT/.otterbot-dev"
PORT="${PORT:-3001}"
CLI="packages/cli/dist/cli.js"

COMMAND="${1:-start}"
shift || true

case "$COMMAND" in
  start | restart)
    echo "[dev-daemon] building workspace…"
    pnpm build
    node "$CLI" "$COMMAND" --port "$PORT"
    echo "[dev-daemon] state dir: .otterbot-dev/ — 'scripts/dev-daemon.sh stop' to stop"
    ;;
  stop | status | logs)
    node "$CLI" "$COMMAND" "$@"
    ;;
  *)
    echo "usage: scripts/dev-daemon.sh [start|stop|restart|status|logs]" >&2
    exit 1
    ;;
esac
