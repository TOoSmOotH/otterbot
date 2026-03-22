# ComfyUI sidecar with GPU auto-detection
#
# Build args:
#   CUDA_TAG    — NVIDIA base image tag (default: 11.8.0-runtime-ubuntu22.04)
#   TORCH_INDEX — PyTorch wheel index URL (default: cu118 for Pascal+ compat)
#
# docker-stack.sh detects the host GPU and passes the appropriate values.
# CUDA 11.8 / cu118 is the safe default — it supports Pascal (sm_61) through Hopper.
# CUDA 12.4 / cu124 gives better performance on Turing (sm_75) and newer.

ARG CUDA_TAG=11.8.0-runtime-ubuntu22.04
FROM nvidia/cuda:${CUDA_TAG}

ARG TORCH_INDEX=https://download.pytorch.org/whl/cu118

ENV DEBIAN_FRONTEND=noninteractive
ENV COMFYUI_HOME=/opt/comfyui
ENV COMFYUI_DATA_ROOT=/data

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    git curl ca-certificates libgl1 libglib2.0-0 \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch with the selected CUDA version
RUN pip install --no-cache-dir \
    torch torchvision torchaudio \
    --index-url ${TORCH_INDEX}

WORKDIR /opt
RUN git clone --depth=1 https://github.com/comfyanonymous/ComfyUI.git "${COMFYUI_HOME}"
WORKDIR ${COMFYUI_HOME}

# Install ComfyUI deps (torch already installed above)
RUN pip install --no-cache-dir -r requirements.txt

COPY docker/comfyui/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8188

ENTRYPOINT ["/entrypoint.sh"]
