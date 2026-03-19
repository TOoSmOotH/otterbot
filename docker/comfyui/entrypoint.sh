#!/bin/sh
set -e

DATA_ROOT="${COMFYUI_DATA_ROOT:-/data}"
COMFYUI_HOME="${COMFYUI_HOME:-/opt/comfyui}"

mkdir -p \
  "${DATA_ROOT}/models" \
  "${DATA_ROOT}/custom_nodes" \
  "${DATA_ROOT}/input" \
  "${DATA_ROOT}/output" \
  "${DATA_ROOT}/user/default/workflows"

rm -rf "${COMFYUI_HOME}/models" "${COMFYUI_HOME}/custom_nodes" "${COMFYUI_HOME}/input" "${COMFYUI_HOME}/output"
ln -sfn "${DATA_ROOT}/models" "${COMFYUI_HOME}/models"
ln -sfn "${DATA_ROOT}/custom_nodes" "${COMFYUI_HOME}/custom_nodes"
ln -sfn "${DATA_ROOT}/input" "${COMFYUI_HOME}/input"
ln -sfn "${DATA_ROOT}/output" "${COMFYUI_HOME}/output"
mkdir -p "${COMFYUI_HOME}/user/default"
rm -rf "${COMFYUI_HOME}/user/default/workflows"
ln -sfn "${DATA_ROOT}/user/default/workflows" "${COMFYUI_HOME}/user/default/workflows"

if [ -f "${DATA_ROOT}/bootstrap.sh" ]; then
  echo "[comfyui] Running bootstrap script..."
  sh "${DATA_ROOT}/bootstrap.sh"
fi

cd "${COMFYUI_HOME}"
python main.py ${CLI_ARGS:---listen 0.0.0.0 --port 8188}
