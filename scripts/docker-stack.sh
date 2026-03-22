#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/docker-stack.sh <stack> [--build] [--no-cache] [up-args...]

Stacks:
  prod               Otterbot production stack
  comfyui            Otterbot + ComfyUI sidecar
  trellis            Otterbot + TRELLIS sidecar
  local-ai           Otterbot + ComfyUI + TRELLIS
  comfyui-nvidia     ComfyUI stack with NVIDIA GPU passthrough
  comfyui-amd        ComfyUI stack with AMD GPU passthrough
  local-ai-nvidia    ComfyUI + TRELLIS with NVIDIA GPU passthrough
  local-ai-amd       ComfyUI + TRELLIS with AMD GPU passthrough
  dev                Otterbot development stack with hot reload
  dev-comfyui        Dev stack + ComfyUI sidecar
  dev-trellis        Dev stack + TRELLIS sidecar
  dev-local-ai       Dev stack + ComfyUI + TRELLIS
  dev-comfyui-nvidia Dev stack + ComfyUI + NVIDIA GPU passthrough
  dev-local-ai-nvidia Dev stack + ComfyUI + TRELLIS + NVIDIA GPU passthrough
  dev-comfyui-amd    Dev stack + ComfyUI + AMD GPU passthrough
  dev-local-ai-amd   Dev stack + ComfyUI + TRELLIS + AMD GPU passthrough

Examples:
  ./scripts/docker-stack.sh prod
  ./scripts/docker-stack.sh prod --build
  ./scripts/docker-stack.sh prod --build --no-cache
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
no_cache_flag=()
while [[ $# -gt 0 ]]; do
  case "${1}" in
    --build)
      build_flag=(--build)
      shift
      ;;
    --no-cache)
      no_cache_flag=(--no-cache)
      shift
      ;;
    *)
      break
      ;;
  esac
done

# ── GPU detection for ComfyUI/TRELLIS CUDA builds ─────────────────────────
# Detect GPU compute capability and select the right CUDA/PyTorch versions.
# Pascal (6.x): cu118 only — CUDA 12 dropped Pascal support.
# Turing+ (7.x+): cu124 for best performance.
# Fallback: cu118 (broadest compatibility).
detect_cuda_build_args() {
  if ! command -v nvidia-smi &>/dev/null; then
    echo "[gpu] nvidia-smi not found — using cu118 (CPU fallback)" >&2
    echo "COMFYUI_CUDA_TAG=11.8.0-runtime-ubuntu22.04"
    echo "COMFYUI_TORCH_INDEX=https://download.pytorch.org/whl/cu118"
    return
  fi
  # Get the highest compute capability across all GPUs
  local compute
  compute=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader,nounits 2>/dev/null | sort -rn | head -1)
  if [[ -z "$compute" ]]; then
    echo "[gpu] Could not query GPU compute capability — using cu118" >&2
    echo "COMFYUI_CUDA_TAG=11.8.0-runtime-ubuntu22.04"
    echo "COMFYUI_TORCH_INDEX=https://download.pytorch.org/whl/cu118"
    return
  fi
  local major="${compute%%.*}"
  echo "[gpu] Detected GPU compute capability: ${compute}" >&2
  if [[ "$major" -le 6 ]]; then
    # Pascal (sm_61): Tesla P4/P40, GTX 10xx — CUDA 12 dropped Pascal
    echo "[gpu] Pascal GPU detected — using CUDA 11.8 / cu118" >&2
    echo "COMFYUI_CUDA_TAG=11.8.0-runtime-ubuntu22.04"
    echo "COMFYUI_TORCH_INDEX=https://download.pytorch.org/whl/cu118"
  elif [[ "$major" -le 9 ]]; then
    # Turing (sm_75): RTX 20xx — through Ada Lovelace (sm_89): RTX 40xx
    echo "[gpu] Turing/Ampere/Ada GPU detected — using CUDA 12.4 / cu124" >&2
    echo "COMFYUI_CUDA_TAG=12.4.1-runtime-ubuntu22.04"
    echo "COMFYUI_TORCH_INDEX=https://download.pytorch.org/whl/cu124"
  else
    # Blackwell (sm_100+): RTX 50xx — needs CUDA 12.8+
    echo "[gpu] Blackwell+ GPU detected — using CUDA 12.8 / cu128" >&2
    echo "COMFYUI_CUDA_TAG=12.8.1-runtime-ubuntu22.04"
    echo "COMFYUI_TORCH_INDEX=https://download.pytorch.org/whl/cu128"
  fi
}

# Export build args if any compose file references comfyui or trellis
needs_gpu_build=false
for file in "${compose_files[@]}"; do
  case "$file" in
    *comfyui*|*trellis*|*gpu*|*local-ai*) needs_gpu_build=true ;;
  esac
done

if [[ "$needs_gpu_build" == "true" ]]; then
  eval "$(detect_cuda_build_args)"
  export COMFYUI_CUDA_TAG COMFYUI_TORCH_INDEX
fi

docker_args=()
for file in "${compose_files[@]}"; do
  docker_args+=(-f "${REPO_ROOT}/${file}")
done

if [[ $# -gt 0 ]]; then
  command=("$@")
else
  command=("${default_command[@]}")
fi

if [[ ${command[0]} == "build" && ${#no_cache_flag[@]} -gt 0 ]]; then
  command+=("${no_cache_flag[@]}")
fi

cd "${REPO_ROOT}"

if [[ ${command[0]} == "up" && ${#build_flag[@]} -gt 0 && ${#no_cache_flag[@]} -gt 0 ]]; then
  docker compose "${docker_args[@]}" build --no-cache
  exec docker compose "${docker_args[@]}" "${command[@]}"
fi

if [[ ${command[0]} == "up" && ${#build_flag[@]} -gt 0 ]]; then
  command+=("${build_flag[@]}")
fi

exec docker compose "${docker_args[@]}" "${command[@]}"
