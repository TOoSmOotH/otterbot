FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV TRELLIS_HOME=/opt/trellis-bridge
ENV TRELLIS_DATA_ROOT=/data

RUN apt-get update && apt-get install -y --no-install-recommends \
    blender git curl ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR ${TRELLIS_HOME}
COPY docker/trellis/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY docker/trellis/server.py ./server.py
COPY docker/trellis/blender_postprocess.py ./blender_postprocess.py
COPY docker/trellis/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
