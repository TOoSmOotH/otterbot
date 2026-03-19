#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/docker-stack.sh <stack> [--build] [up-args...]

Stacks:
  prod               Otterbot production stack
  comfyui            Otterbot + ComfyUI sidecar
  trellis            Otterbot + TRELLIS sidecar
  local-ai           Otterbot + ComfyUI + TRELLIS
  dev                Otterbot development stack with hot reload
  dev-comfyui        Dev stack + ComfyUI sidecar
  dev-trellis        Dev stack + TRELLIS sidecar
  dev-local-ai       Dev stack + ComfyUI + TRELLIS
  comfyui-nvidia     ComfyUI stack with NVIDIA GPU passthrough
  local-ai-nvidia    ComfyUI + TRELLIS with NVIDIA GPU passthrough
  comfyui-amd        ComfyUI stack with AMD GPU passthrough
  local-ai-amd       ComfyUI + TRELLIS with AMD GPU passthrough
  dev-comfyui-nvidia Dev stack + ComfyUI + NVIDIA GPU passthrough
  dev-local-ai-nvidia Dev stack + ComfyUI + TRELLIS + NVIDIA GPU passthrough
  dev-comfyui-amd    Dev stack + ComfyUI + AMD GPU passthrough
  dev-local-ai-amd   Dev stack + ComfyUI + TRELLIS + AMD GPU passthrough

Examples:
  ./scripts/docker-stack.sh prod
  ./scripts/docker-stack.sh comfyui --build
  ./scripts/docker-stack.sh dev-local-ai
  ./scripts/docker-stack.sh local-ai-nvidia
  ./scripts/docker-stack.sh local-ai down
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

STACK="$1"
shift

compose_files=("docker-compose.prod.yml")
default_command=(up -d)

case "$STACK" in
  prod)
    ;;
  comfyui)
    compose_files+=("docker-compose.comfyui.yml")
    ;;
  trellis)
    compose_files+=("docker-compose.trellis.yml")
    ;;
  local-ai)
    compose_files+=("docker-compose.comfyui.yml" "docker-compose.trellis.yml")
    ;;
  comfyui-nvidia)
    compose_files+=("docker-compose.comfyui.yml" "docker-compose.gpu-nvidia.yml")
    ;;
  local-ai-nvidia)
    compose_files+=("docker-compose.comfyui.yml" "docker-compose.trellis.yml" "docker-compose.gpu-nvidia.yml")
    ;;
  comfyui-amd)
    compose_files+=("docker-compose.comfyui.yml" "docker-compose.gpu-amd.yml")
    ;;
  local-ai-amd)
    compose_files+=("docker-compose.comfyui.yml" "docker-compose.trellis.yml" "docker-compose.gpu-amd.yml")
    ;;
  dev)
    compose_files=("docker-compose.yml" "docker-compose.dev.yml")
    default_command=(up)
    ;;
  dev-comfyui)
    compose_files=("docker-compose.yml" "docker-compose.dev.yml" "docker-compose.comfyui.yml")
    default_command=(up)
    ;;
  dev-trellis)
    compose_files=("docker-compose.yml" "docker-compose.dev.yml" "docker-compose.trellis.yml")
    default_command=(up)
    ;;
  dev-local-ai)
    compose_files=("docker-compose.yml" "docker-compose.dev.yml" "docker-compose.comfyui.yml" "docker-compose.trellis.yml")
    default_command=(up)
    ;;
  dev-comfyui-nvidia)
    compose_files=("docker-compose.yml" "docker-compose.dev.yml" "docker-compose.comfyui.yml" "docker-compose.gpu-nvidia.yml")
    default_command=(up)
    ;;
  dev-local-ai-nvidia)
    compose_files=("docker-compose.yml" "docker-compose.dev.yml" "docker-compose.comfyui.yml" "docker-compose.trellis.yml" "docker-compose.gpu-nvidia.yml")
    default_command=(up)
    ;;
  dev-comfyui-amd)
    compose_files=("docker-compose.yml" "docker-compose.dev.yml" "docker-compose.comfyui.yml" "docker-compose.gpu-amd.yml")
    default_command=(up)
    ;;
  dev-local-ai-amd)
    compose_files=("docker-compose.yml" "docker-compose.dev.yml" "docker-compose.comfyui.yml" "docker-compose.trellis.yml" "docker-compose.gpu-amd.yml")
    default_command=(up)
    ;;
  -h|--help|help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown stack: $STACK" >&2
    usage
    exit 1
    ;;
esac

build_flag=()
if [[ ${1:-} == "--build" ]]; then
  build_flag=(--build)
  shift
fi

docker_args=()
for file in "${compose_files[@]}"; do
  docker_args+=(-f "$file")
done

if [[ $# -gt 0 ]]; then
  command=("$@")
else
  command=("${default_command[@]}")
fi

if [[ ${command[0]} == "up" && ${#build_flag[@]} -gt 0 ]]; then
  command+=("${build_flag[@]}")
fi

exec docker compose "${docker_args[@]}" "${command[@]}"
