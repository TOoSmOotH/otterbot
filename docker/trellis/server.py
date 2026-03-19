import base64
import io
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image

app = FastAPI(title="Otterbot TRELLIS Bridge")

DATA_ROOT = Path(os.environ.get("TRELLIS_DATA_ROOT", "/data"))
OUTPUT_ROOT = DATA_ROOT / "output"
INPUT_ROOT = DATA_ROOT / "input"
MODEL_REF = os.environ.get("TRELLIS_MODEL_REF", "microsoft/TRELLIS-image-large")
INFERENCE_CMD = os.environ.get("TRELLIS_INFERENCE_CMD", "").strip()


def ensure_dirs() -> None:
  OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
  INPUT_ROOT.mkdir(parents=True, exist_ok=True)


def _placeholder_glb() -> bytes:
  glb_hex = (
    "676c5446020000005c010000d80000004a534f4e7b226173736574223a7b2276657273696f6e223a22322e3022"
    "2c2267656e657261746f72223a226f74746572626f742d7472656c6c69732d627269646765227d2c227363656e6522"
    "3a302c227363656e6573223a5b7b226e6f646573223a5b305d7d5d2c226e6f646573223a5b7b226d657368223a307d5d"
    "2c226d6573686573223a5b7b227072696d697469766573223a5b7b2261747472696275746573223a7b22504f53495449"
    "4f4e223a307d2c22696e6469636573223a317d5d7d5d2c226163636573736f7273223a5b7b2262756666657256696577"
    "223a302c22636f6d706f6e656e7454797065223a353132362c22636f756e74223a332c2274797065223a225645433322"
    "2c226d6178223a5b302e352c302e352c302e305d2c226d696e223a5b2d302e352c2d302e352c302e305d7d2c7b226275"
    "6666657256696577223a312c22636f6d706f6e656e7454797065223a353132332c22636f756e74223a332c2274797065"
    "223a225343414c4152222c226d6178223a5b325d2c226d696e223a5b305d7d5d2c226275666665725669657773223a5b"
    "7b22627566666572223a302c22627974654f6666736574223a302c22627974654c656e677468223a33362c2274617267"
    "6574223a33343936327d2c7b22627566666572223a302c22627974654f6666736574223a33362c22627974654c656e67"
    "7468223a362c22746172676574223a33343936337d5d2c2262756666657273223a5b7b22627974654c656e677468223a"
    "34347d5d7d2020200042494e2c000000000000bf000000bf0000000000003f000000bf0000000000000000003f000000"
    "00000001000200"
  )
  return bytes.fromhex(glb_hex)


def _postprocess_with_blender(input_path: Path, preset: str) -> Path:
  if os.environ.get("ENABLE_BLENDER_POSTPROCESS", "true").lower() == "false":
    return input_path

  output_path = input_path.with_name(f"{input_path.stem}-{preset}.glb")
  command = [
    "blender",
    "--background",
    "--python",
    "/opt/trellis-bridge/blender_postprocess.py",
    "--",
    "--input",
    str(input_path),
    "--output",
    str(output_path),
    "--preset",
    preset,
  ]
  try:
    subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return output_path
  except Exception:
    return input_path


def _run_trellis_image_to_glb(image_path: Path, prompt: str, complexity: str) -> Path:
  """
  Placeholder bridge for the actual TRELLIS runtime.

  If the official runtime is not installed in this container yet, emit a small GLB so the
  Otterbot pipeline and Blender post-process path remain wired up. A real deployment should
  replace this with the official TRELLIS image-to-3D inference call.
  """
  ensure_dirs()
  output_path = OUTPUT_ROOT / f"{image_path.stem}-{complexity}.glb"
  if INFERENCE_CMD:
    command = INFERENCE_CMD.format(
      image=str(image_path),
      output=str(output_path),
      prompt=prompt,
      complexity=complexity,
      model_ref=MODEL_REF,
    )
    subprocess.run(command, shell=True, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if not output_path.exists():
      raise RuntimeError("TRELLIS inference command completed without producing an output file")
    return output_path

  output_path.write_bytes(_placeholder_glb())
  return output_path


@app.get("/health")
def health() -> JSONResponse:
  ensure_dirs()
  return JSONResponse({
    "ready": True,
    "message": "TRELLIS bridge reachable. Configure TRELLIS_INFERENCE_CMD for real image-to-3D inference; otherwise the bridge returns a placeholder mesh and still exercises the Blender post-process path.",
    "modelRef": MODEL_REF,
    "inferenceConfigured": bool(INFERENCE_CMD),
    "blenderEnabled": os.environ.get("ENABLE_BLENDER_POSTPROCESS", "true").lower() != "false",
  })


@app.post("/generate")
async def generate(
  prompt: str = Form(...),
  format: str = Form("glb"),
  complexity: str = Form("medium"),
  blenderPreset: str = Form("game-ready"),
) -> JSONResponse:
  if format != "glb":
    raise HTTPException(status_code=400, detail="This bridge currently returns GLB only")
  temp_image = INPUT_ROOT / "text-fallback.png"
  if not temp_image.exists():
    Image.new("RGBA", (512, 512), (180, 180, 180, 255)).save(temp_image)
  output_path = _run_trellis_image_to_glb(temp_image, prompt, complexity)
  final_path = _postprocess_with_blender(output_path, blenderPreset)
  return JSONResponse({
    "modelBase64": base64.b64encode(final_path.read_bytes()).decode("utf-8"),
    "format": "glb",
  })


@app.post("/generate-from-image")
async def generate_from_image(
  image: UploadFile | None = File(default=None),
  imageUrl: str | None = Form(default=None),
  prompt: str = Form("Generate a clean 3D model from this image"),
  format: str = Form("glb"),
  complexity: str = Form("medium"),
  blenderPreset: str = Form("game-ready"),
) -> JSONResponse:
  if format != "glb":
    raise HTTPException(status_code=400, detail="This bridge currently returns GLB only")

  ensure_dirs()
  with tempfile.TemporaryDirectory(dir=INPUT_ROOT) as temp_dir:
    temp_dir_path = Path(temp_dir)
    if image is not None:
      source_path = temp_dir_path / image.filename
      source_path.write_bytes(await image.read())
    elif imageUrl:
      raise HTTPException(status_code=400, detail="imageUrl passthrough is not yet supported by the sidecar; upload the image file instead")
    else:
      raise HTTPException(status_code=400, detail="image or imageUrl is required")

    output_path = _run_trellis_image_to_glb(source_path, prompt, complexity)
    final_path = _postprocess_with_blender(output_path, blenderPreset)
    stable_output = OUTPUT_ROOT / final_path.name
    if final_path != stable_output:
      shutil.copyfile(final_path, stable_output)

  return JSONResponse({
    "modelBase64": base64.b64encode(stable_output.read_bytes()).decode("utf-8"),
    "format": "glb",
  })
