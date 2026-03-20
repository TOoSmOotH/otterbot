import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ToolContext } from "./tool-context.js";
import { getModelProvider } from "../asset-providers/asset-adapter.js";
import { getGame } from "../games/game-service.js";
import type { GameAsset } from "@otterbot/shared";
import { resolveUploadedImagePath } from "./upload-paths.js";

export function createGameGenModelFromImageTool(ctx: ToolContext) {
  return tool({
    description:
      "Generate a 3D model from an uploaded or local reference image. " +
      "Designed for TRELLIS-style image-to-3D workflows with optional Blender cleanup in the sidecar. " +
      "Saves the model to assets/models/.",
    parameters: z.object({
      gameId: z.string().describe("The game ID to add the model to"),
      imageRef: z.string().describe("Uploaded image URL like /uploads/abc.png, or a local workspace path"),
      prompt: z.string().optional().describe("Optional guidance describing the object, materials, or style"),
      filename: z.string().optional().describe("Output filename (without extension)"),
      format: z.enum(["glb", "gltf", "obj"]).optional().describe("Output format (default: glb)"),
      complexity: z.enum(["low", "medium", "high"]).optional().describe("Geometry complexity hint"),
      blenderPreset: z.enum(["preview", "game-ready", "high-detail"]).optional().describe("Blender cleanup/export preset"),
    }),
    execute: async ({ gameId, imageRef, prompt, filename, format, complexity, blenderPreset }) => {
      const game = getGame(ctx.workspacePath, gameId);
      if (!game) return JSON.stringify({ error: `Game ${gameId} not found` });

      const sourceImagePath = resolveUploadedImagePath(imageRef);
      const provider = getModelProvider();
      const result = await provider.generate(prompt ?? "Generate a clean 3D model from this reference image", {
        format,
        complexity,
        sourceImagePath,
        sourceImageUrl: imageRef.startsWith("/uploads/") ? imageRef : undefined,
        blenderPreset,
      });

      const name = filename ?? `model_from_image_${nanoid(8)}`;
      const ext = result.format;
      const relPath = `assets/models/${name}.${ext}`;
      const gameDir = path.join(ctx.workspacePath, "games", gameId);
      const absPath = path.join(gameDir, relPath);

      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, result.data);

      const asset: GameAsset = {
        id: nanoid(12),
        gameId,
        type: "model",
        name: `${name}.${ext}`,
        path: relPath,
        generatedBy: provider.type === "procedural" ? "procedural" : "ai-model",
        prompt: prompt ?? `Model generated from reference image: ${imageRef}`,
        createdAt: new Date().toISOString(),
      };

      return JSON.stringify({
        asset,
        provider: result.provider,
        sourceImage: imageRef,
        size: result.data.length,
        path: relPath,
      }, null, 2);
    },
  });
}
