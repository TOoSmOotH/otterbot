import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ToolContext } from "./tool-context.js";
import { getImageProvider } from "../asset-providers/asset-adapter.js";
import { getApp } from "../apps/app-service.js";

export function createAppGenAssetTool(ctx: ToolContext) {
  return tool({
    description:
      "Generate a visual asset for a web application using AI or procedural generation. " +
      "Saves the image to the app's assets/images/ directory. " +
      "Supports logos, favicons, hero images, Open Graph images, and icons. " +
      "Use this tool for logo requests by default; do not hand-author SVG or vector artwork unless the user explicitly asks for SVG/vector output.",
    parameters: z.object({
      appId: z.string().describe("The app ID to add the asset to"),
      prompt: z.string().describe("Description of the image to generate (e.g. 'minimalist blue gradient logo', 'hero banner with mountains')"),
      assetType: z
        .enum(["logo", "favicon", "hero", "og-image", "icon"])
        .describe("Type of asset to generate. For normal logo requests, prefer this raster path unless SVG/vector is explicitly requested."),
      filename: z.string().optional().describe("Output filename (without extension, defaults to a generated name)"),
      width: z.number().optional().describe("Width in pixels (default depends on asset type)"),
      height: z.number().optional().describe("Height in pixels (default depends on asset type)"),
    }),
    execute: async ({ appId, prompt, assetType, filename, width, height }) => {
      const app = getApp(ctx.workspacePath, appId);
      if (!app) return JSON.stringify({ error: `App ${appId} not found` });

      // Default dimensions by asset type
      const defaults: Record<string, { w: number; h: number }> = {
        logo: { w: 512, h: 512 },
        favicon: { w: 32, h: 32 },
        hero: { w: 1200, h: 630 },
        "og-image": { w: 1200, h: 630 },
        icon: { w: 128, h: 128 },
      };

      const dim = defaults[assetType] ?? { w: 512, h: 512 };
      const w = width ?? dim.w;
      const h = height ?? dim.h;

      const provider = getImageProvider();
      const result = await provider.generate(prompt, {
        width: w,
        height: h,
        taskType: assetType === "logo" || assetType === "favicon" || assetType === "icon" ? "icon" : "hero",
      });

      // Save to app assets
      const name = filename ?? `${assetType}_${nanoid(8)}`;
      const ext = result.mimeType === "image/png" ? "png" : "jpg";
      const relPath = `assets/images/${name}.${ext}`;
      const appDirPath = path.join(ctx.workspacePath, "apps", appId);
      const absPath = path.join(appDirPath, relPath);

      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, result.data);

      return JSON.stringify({
        assetType,
        path: relPath,
        provider: result.provider,
        size: result.data.length,
        dimensions: { width: w, height: h },
      }, null, 2);
    },
  });
}
