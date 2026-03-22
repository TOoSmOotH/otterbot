# TRELLIS 3D generation bridge with GPU auto-detection
#
# Build args:
#   CUDA_TAG    — NVIDIA base image tag (default: 11.8.0-runtime-ubuntu22.04)
#   TORCH_INDEX — PyTorch wheel index URL (default: cu118 for Pascal+ compat)
#
# docker-stack.sh detects the host GPU and passes the appropriate values.

ARG CUDA_TAG=11.8.0-runtime-ubuntu22.04
FROM nvidia/cuda:${CUDA_TAG}

ARG TORCH_INDEX=https://download.pytorch.org/whl/cu118

ENV DEBIAN_FRONTEND=noninteractive
ENV TRELLIS_HOME=/opt/trellis-bridge
ENV TRELLIS_DATA_ROOT=/data

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    blender git curl ca-certificates ffmpeg \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch with the selected CUDA version (for TRELLIS inference)
RUN pip install --no-cache-dir \
    torch torchvision \
    --index-url ${TORCH_INDEX}

WORKDIR ${TRELLIS_HOME}
COPY docker/trellis/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY docker/trellis/server.py ./server.py
COPY docker/trellis/blender_postprocess.py ./blender_postprocess.py
COPY docker/trellis/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
