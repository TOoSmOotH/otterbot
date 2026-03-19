import argparse
import bpy


def apply_preset(preset: str) -> None:
  mesh_objects = [obj for obj in bpy.data.objects if obj.type == "MESH"]
  if not mesh_objects:
    return

  for obj in mesh_objects:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if preset == "preview":
      continue
    if preset in {"game-ready", "high-detail"}:
      bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
      modifier = obj.modifiers.new(name="Decimate", type="DECIMATE")
      modifier.ratio = 0.55 if preset == "game-ready" else 0.85
      bpy.ops.object.modifier_apply(modifier=modifier.name)


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--input", required=True)
  parser.add_argument("--output", required=True)
  parser.add_argument("--preset", default="game-ready")
  args = parser.parse_args()

  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.ops.import_scene.gltf(filepath=args.input)
  apply_preset(args.preset)
  bpy.ops.export_scene.gltf(filepath=args.output, export_format="GLB")


if __name__ == "__main__":
  main()
