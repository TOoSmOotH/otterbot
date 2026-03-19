FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV COMFYUI_HOME=/opt/comfyui
ENV COMFYUI_DATA_ROOT=/data

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --depth=1 https://github.com/comfyanonymous/ComfyUI.git "${COMFYUI_HOME}"
WORKDIR ${COMFYUI_HOME}
RUN pip install --no-cache-dir -r requirements.txt

COPY docker/comfyui/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8188

ENTRYPOINT ["/entrypoint.sh"]
