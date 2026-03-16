import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tool-context.js";
import { getAppDistPath, getAppSourcePath, buildApp } from "../apps/app-service.js";
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
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
};

export function createAppPreviewTool(ctx: ToolContext) {
  return tool({
    description:
      "Start or stop a local preview server for a web application. Returns a URL where the app can be viewed in a browser. The app is auto-built before previewing by default.",
    parameters: z.object({
      action: z.enum(["start", "stop"]).describe("Start or stop the preview server"),
      appId: z.string().describe("The app ID to preview"),
      port: z.number().optional().describe("Preferred port (auto-selects a free port if omitted)"),
      autoBuild: z.boolean().optional().describe("Automatically build the app before starting preview (default: true)"),
    }),
    execute: async ({ action, appId, port: preferredPort, autoBuild }) => {
      if (action === "stop") {
        const existing = activeServers.get(appId);
        if (existing) {
          existing.server.close();
          activeServers.delete(appId);
          return JSON.stringify({ ok: true, message: "Preview server stopped" });
        }
        return JSON.stringify({ ok: true, message: "No preview server running for this app" });
      }

      // Auto-build if requested (default behavior)
      if (autoBuild !== false) {
        const buildResult = buildApp(ctx.workspacePath, appId);
        if (!buildResult.ok) {
          return JSON.stringify({ error: `Build failed: ${buildResult.error}` });
        }
      }

      let servePath = getAppDistPath(ctx.workspacePath, appId);
      if (!servePath) {
        // Fall back to source directory
        servePath = getAppSourcePath(ctx.workspacePath, appId);
        if (!servePath) {
          return JSON.stringify({ error: "App not found" });
        }
      }

      // Stop existing server if any
      const existing = activeServers.get(appId);
      if (existing) {
        existing.server.close();
        activeServers.delete(appId);
      }

      const port = preferredPort ?? await findFreePort();
      const basePath = servePath;

      const server = http.createServer((req, res) => {
        const urlPath = req.url?.split("?")[0] ?? "/";
        let filePath = path.join(basePath, urlPath === "/" ? "index.html" : urlPath);

        // Prevent directory traversal
        if (!filePath.startsWith(basePath)) {
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

      activeServers.set(appId, { server, port });

      const url = `http://localhost:${port}`;
      return JSON.stringify({ ok: true, url, port, appId }, null, 2);
    },
  });
}
