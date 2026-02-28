#!/bin/sh
# Otterbot installer — https://otterbot.ai
# Usage: curl -fsSL https://otterbot.ai/install.sh | sh
#
# Environment variables:
#   OTTERBOT_DIR   — install directory (default: $HOME/otterbot)
#
# Flags:
#   --dir <path>   — custom install directory
#   --beta         — use :beta image tag instead of :latest
#   --no-start     — set up files but don't pull/start the container
#   --help         — show usage

set -eu

# ── Defaults ──────────────────────────────────────────────────────────────────

IMAGE="ghcr.io/toosmooth/otterbot"
TAG="latest"
INSTALL_DIR="${OTTERBOT_DIR:-$HOME/otterbot}"
NO_START=0

# ── Colours (disabled when not a tty) ────────────────────────────────────────

if [ -t 1 ]; then
  BOLD='\033[1m'
  GREEN='\033[32m'
  YELLOW='\033[33m'
  RED='\033[31m'
  RESET='\033[0m'
else
  BOLD='' GREEN='' YELLOW='' RED='' RESET=''
fi

info()  { printf "${GREEN}▸${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}▸${RESET} %s\n" "$*"; }
error() { printf "${RED}✗${RESET} %s\n" "$*" >&2; }
bold()  { printf "${BOLD}%s${RESET}" "$*"; }

# ── Helpers ───────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Otterbot Installer

Usage:
  curl -fsSL https://otterbot.ai/install.sh | sh
  curl -fsSL https://otterbot.ai/install.sh | sh -s -- [OPTIONS]

Options:
  --dir <path>   Install directory (default: \$HOME/otterbot)
  --beta         Use the beta image tag
  --no-start     Generate files but don't start the container
  --help         Show this help message
EOF
  exit 0
}

prompt_yn() {
  # prompt_yn "question" default(y/n)
  printf "%s " "$1"
  read -r answer </dev/tty
  case "$answer" in
    [Yy]*) return 0 ;;
    [Nn]*) return 1 ;;
    "")
      case "$2" in
        y) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    *) return 1 ;;
  esac
}

generate_secret() {
  # Try openssl first, fall back to /dev/urandom
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 16
  else
    od -An -tx1 -N16 /dev/urandom | tr -d ' \n'
  fi
}

# ── Parse arguments ──────────────────────────────────────────────────────────

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)
      shift
      if [ $# -eq 0 ]; then
        error "--dir requires a path argument"
        exit 1
      fi
      INSTALL_DIR="$1"
      ;;
    --beta)
      TAG="beta"
      ;;
    --no-start)
      NO_START=1
      ;;
    --help|-h)
      usage
      ;;
    *)
      error "Unknown option: $1"
      usage
      ;;
  esac
  shift
done

# ── Detect OS & architecture ─────────────────────────────────────────────────

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)  OS_NAME="Linux" ;;
  Darwin) OS_NAME="macOS" ;;
  *)
    error "Unsupported operating system: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH_NAME="x86_64" ;;
  aarch64|arm64) ARCH_NAME="arm64" ;;
  *)
    error "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

info "Detected $(bold "$OS_NAME") on $(bold "$ARCH_NAME")"

# ── Check for Docker ─────────────────────────────────────────────────────────

if ! command -v docker >/dev/null 2>&1; then
  warn "Docker is not installed."

  if [ "$OS_NAME" = "Linux" ]; then
    if prompt_yn "Install Docker via get.docker.com? [y/N]" n; then
      info "Installing Docker..."
      curl -fsSL https://get.docker.com | sh
      # Add current user to docker group (takes effect on next login)
      if command -v usermod >/dev/null 2>&1; then
        sudo usermod -aG docker "$(whoami)" 2>/dev/null || true
        warn "Added $(whoami) to the docker group. You may need to log out and back in."
      fi
    else
      error "Docker is required. Install it from https://docs.docker.com/get-docker/ and re-run this script."
      exit 1
    fi
  elif [ "$OS_NAME" = "macOS" ]; then
    if command -v brew >/dev/null 2>&1; then
      if prompt_yn "Install Docker Desktop via Homebrew? [y/N]" n; then
        info "Installing Docker Desktop..."
        brew install --cask docker
        warn "Please launch Docker Desktop from Applications, then re-run this script."
        exit 0
      fi
    fi
    error "Docker is required. Install Docker Desktop from https://docker.com/products/docker-desktop and re-run this script."
    exit 1
  fi
fi

# ── Check Docker is running ──────────────────────────────────────────────────

if ! docker info >/dev/null 2>&1; then
  error "Docker is installed but not running. Please start Docker and re-run this script."
  if [ "$OS_NAME" = "macOS" ]; then
    error "Hint: launch Docker Desktop from Applications."
  fi
  exit 1
fi

info "Docker is running"

# ── Check for Docker Compose v2 ──────────────────────────────────────────────

if ! docker compose version >/dev/null 2>&1; then
  error "Docker Compose v2 is required but not found."
  error "Modern Docker Desktop and Docker Engine include it as a plugin."
  error "Please upgrade Docker: https://docs.docker.com/compose/install/"
  exit 1
fi

info "Docker Compose v2 detected"

# ── Check for existing installation ──────────────────────────────────────────

if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
  warn "Existing installation found at $INSTALL_DIR"
  if ! prompt_yn "Overwrite docker-compose.yml? (your .env will be preserved) [y/N]" n; then
    info "Aborted. Existing installation left untouched."
    exit 0
  fi
fi

# ── Create directory structure ────────────────────────────────────────────────

info "Installing to $(bold "$INSTALL_DIR")"
mkdir -p "$INSTALL_DIR/data"

# ── Generate .env (never overwrite) ──────────────────────────────────────────

if [ -f "$INSTALL_DIR/.env" ]; then
  info "Existing .env found — preserving it"
else
  DB_KEY="$(generate_secret)"
  cat > "$INSTALL_DIR/.env" <<EOF
# Otterbot environment — generated by install.sh
OTTERBOT_DB_KEY=${DB_KEY}
OTTERBOT_UID=$(id -u)
OTTERBOT_GID=$(id -g)
OTTERBOT_DATA_DIR=./data
ENABLE_DESKTOP=true
DESKTOP_RESOLUTION=1280x720x24
SUDO_MODE=restricted
EOF
  info "Generated .env with new database key"
fi

# ── Generate docker-compose.yml ──────────────────────────────────────────────

cat > "$INSTALL_DIR/docker-compose.yml" <<EOF
services:
  otterbot:
    image: ${IMAGE}:${TAG}
    shm_size: "256m"
    ports:
      - "\${PORT:-62626}:62626"
    volumes:
      - \${OTTERBOT_DATA_DIR:-./data}:/otterbot
    environment:
      - OTTERBOT_DB_KEY=\${OTTERBOT_DB_KEY}
      - OTTERBOT_UID=\${OTTERBOT_UID:-1000}
      - OTTERBOT_GID=\${OTTERBOT_GID:-1000}
      - ENABLE_DESKTOP=\${ENABLE_DESKTOP:-true}
      - DESKTOP_RESOLUTION=\${DESKTOP_RESOLUTION:-1280x720x24}
      - SUDO_MODE=\${SUDO_MODE:-restricted}
      - OTTERBOT_ALLOWED_ORIGIN=\${OTTERBOT_ALLOWED_ORIGIN:-}
    restart: unless-stopped
EOF

info "Generated docker-compose.yml (image tag: ${TAG})"

# ── Pull & start ─────────────────────────────────────────────────────────────

if [ "$NO_START" -eq 1 ]; then
  info "Skipping pull & start (--no-start)"
else
  info "Pulling image..."
  (cd "$INSTALL_DIR" && docker compose pull)

  info "Starting Otterbot..."
  (cd "$INSTALL_DIR" && docker compose up -d)
fi

# ── Success ───────────────────────────────────────────────────────────────────

printf "\n"
printf '%s%sOtterbot is installed!%s\n' "$GREEN" "$BOLD" "$RESET"
printf "\n"
printf "  %-12s %s\n" "URL:" "https://localhost:62626  (self-signed certificate)"
printf "  %-12s %s\n" "Data:" "$INSTALL_DIR/data"
printf "  %-12s %s\n" "Config:" "$INSTALL_DIR/.env"
printf "\n"
printf "  %-12s %s\n" "Stop:" "cd $INSTALL_DIR && docker compose down"
printf "  %-12s %s\n" "Start:" "cd $INSTALL_DIR && docker compose up -d"
printf "  %-12s %s\n" "Logs:" "cd $INSTALL_DIR && docker compose logs -f"
printf "  %-12s %s\n" "Update:" "cd $INSTALL_DIR && docker compose pull && docker compose up -d"
printf "\n"
