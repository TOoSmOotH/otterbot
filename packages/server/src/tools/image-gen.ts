import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ChatAttachment } from "@otterbot/shared";
import type { ToolContext } from "./tool-context.js";
import { getImageProvider } from "../games/asset-providers/asset-adapter.js";
import { uploadsRoot } from "./upload-paths.js";

export function createImageGenTool(ctx: ToolContext) {
  return tool({
    description:
      "Generate a one-off image without attaching it to a game or app project. " +
      "Use this for testing local image generation, creating standalone mockups, logos, icons, textures, sprites, and concept art. " +
      "Saves the image under generated/images/ in the current workspace.",
    parameters: z.object({
      prompt: z.string().describe("Description of the image to generate"),
      filename: z.string().optional().describe("Output filename without extension"),
      width: z.number().optional().describe("Width in pixels (default: 1024)"),
      height: z.number().optional().describe("Height in pixels (default: 1024)"),
      style: z.string().optional().describe("Style hint: pixel-art, photorealistic, cartoon, minimal, etc."),
      taskType: z
        .enum(["image", "icon", "hero", "sprite", "texture"])
        .optional()
        .describe("Image task category used to select the best local preset"),
      presetId: z.string().optional().describe("Optional preset override for ComfyUI-backed generation"),
    }),
    execute: async ({ prompt, filename, width, height, style, taskType, presetId }) => {
      const provider = getImageProvider();
      const imageWidth = width ?? 1024;
      const imageHeight = height ?? 1024;
      const result = await provider.generate(prompt, {
        width: imageWidth,
        height: imageHeight,
        style,
        taskType,
        presetId,
      });

      const name = filename ?? `image_${nanoid(8)}`;
      const ext = result.mimeType === "image/png" ? "png" : "jpg";
      const relPath = path.join("generated", "images", `${name}.${ext}`);
      const absPath = path.join(ctx.workspacePath, relPath);
      const uploadId = nanoid();
      const uploadFilename = `${uploadId}.${ext}`;
      const uploadPath = path.join(uploadsRoot(), uploadFilename);

      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.mkdirSync(path.dirname(uploadPath), { recursive: true });
      fs.writeFileSync(absPath, result.data);
      fs.writeFileSync(uploadPath, result.data);

      const chatAttachment: ChatAttachment = {
        id: uploadId,
        filename: `${name}.${ext}`,
        mimeType: result.mimeType,
        size: result.data.length,
        url: `/uploads/${uploadFilename}`,
      };

      return JSON.stringify({
        prompt,
        path: relPath,
        absolutePath: absPath,
        chatAttachment,
        provider: result.provider,
        size: result.data.length,
        dimensions: { width: imageWidth, height: imageHeight },
        style,
        taskType: taskType ?? "image",
        presetId: presetId ?? null,
      }, null, 2);
    },
  });
}
