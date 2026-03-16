import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tool-context.js";
import { getGameDistPath, getGameSourcePath, buildGame } from "../games/game-service.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";

// Track active preview servers
const activeServers = new Map<string, { server: http.Server; port: number }>();

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      if (addr && typeof addr !== "string") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Could not find free port")));
      }
    });
  });
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".wasm": "application/wasm",
};

export function createGamePreviewTool(ctx: ToolContext) {
  return tool({
    description:
      "Start or stop a local preview server for a game. Returns a URL where the game can be played in a browser. The game must be built first (use game_build).",
    parameters: z.object({
      action: z.enum(["start", "stop"]).describe("Start or stop the preview server"),
      gameId: z.string().describe("The game ID to preview"),
      autoBuild: z.boolean().optional().describe("Automatically build the game before starting preview (default: true)"),
    }),
    execute: async ({ action, gameId, autoBuild }) => {
      if (action === "stop") {
        const existing = activeServers.get(gameId);
        if (existing) {
          existing.server.close();
          activeServers.delete(gameId);
          return JSON.stringify({ ok: true, message: "Preview server stopped" });
        }
        return JSON.stringify({ ok: true, message: "No preview server running for this game" });
      }

      // Auto-build if requested (default behavior)
      if (autoBuild !== false) {
        const buildResult = buildGame(ctx.workspacePath, gameId);
        if (!buildResult.ok) {
          return JSON.stringify({ error: `Build failed: ${buildResult.error}` });
        }
      }

      let distPath = getGameDistPath(ctx.workspacePath, gameId);
      if (!distPath) {
        // Fall back to source directory
        distPath = getGameSourcePath(ctx.workspacePath, gameId);
        if (!distPath) {
          return JSON.stringify({ error: "Game not found" });
        }
      }

      // Stop existing server if any
      const existing = activeServers.get(gameId);
      if (existing) {
        existing.server.close();
        activeServers.delete(gameId);
      }

      const port = await findFreePort();
      const servePath = distPath;

      const server = http.createServer((req, res) => {
        const urlPath = req.url?.split("?")[0] ?? "/";
        let filePath = path.join(servePath, urlPath === "/" ? "index.html" : urlPath);

        // Prevent directory traversal
        if (!filePath.startsWith(servePath)) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }

        if (!fs.existsSync(filePath)) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }

        if (fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, "index.html");
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

        const content = fs.readFileSync(filePath);
        res.writeHead(200, { "Content-Type": contentType, "Access-Control-Allow-Origin": "*" });
        res.end(content);
      });

      await new Promise<void>((resolve) => server.listen(port, resolve));

      activeServers.set(gameId, { server, port });

      const url = `http://localhost:${port}`;
      return JSON.stringify({ ok: true, url, port, gameId }, null, 2);
    },
  });
}
