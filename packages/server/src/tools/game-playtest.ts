/**
 * Automated game playtesting tool.
 *
 * Launches a game in a headless Playwright browser, injects engine-aware
 * instrumentation, runs automated interactions, captures screenshots
 * and performance metrics, and returns a structured PlaytestResult.
 */

import { tool } from "ai";
import { z } from "zod";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import type { ToolContext } from "./tool-context.js";
import { getGame, getGameDistPath, getGameSourcePath, buildGame } from "../games/game-service.js";
import type { PlaytestResult, PlaytestBug, PerformanceMetrics } from "@otterbot/shared";

// Reuse the preview server mechanism
import http from "node:http";
import net from "node:net";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".wasm": "application/wasm",
};

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

function startStaticServer(servePath: string, port: number): http.Server {
  const server = http.createServer((req, res) => {
    const urlPath = req.url?.split("?")[0] ?? "/";
    let filePath = path.join(servePath, urlPath === "/" ? "index.html" : urlPath);
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
  server.listen(port);
  return server;
}

/** Engine-aware instrumentation injected into the game page. */
const INSTRUMENTATION_SCRIPT = `
(() => {
  // Frame time tracking
  const frameTimes = [];
  let frameCount = 0;
  let lastFrameTime = performance.now();

  const origRAF = window.requestAnimationFrame;
  window.requestAnimationFrame = function(cb) {
    return origRAF.call(window, function(ts) {
      const now = performance.now();
      frameTimes.push(now - lastFrameTime);
      lastFrameTime = now;
      frameCount++;
      // Keep only last 300 frames
      if (frameTimes.length > 300) frameTimes.shift();
      cb(ts);
    });
  };

  // Console error tracking
  const errors = [];
  const origError = console.error;
  console.error = function(...args) {
    errors.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
    origError.apply(console, args);
  };

  // Expose metrics collector
  window.__PLAYTEST__ = {
    getMetrics: () => {
      const avgFrame = frameTimes.length > 0 ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length : 16.67;
      const maxFrame = frameTimes.length > 0 ? Math.max(...frameTimes) : 16.67;
      return {
        avgFps: Math.round(1000 / avgFrame),
        minFps: Math.round(1000 / maxFrame),
        frameCount,
        memoryUsageMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) : 0,
      };
    },
    getErrors: () => errors,
    getGameState: () => window.__GAME_STATE__ || null,
    getGameAPI: () => typeof window.__GAME_API__ === 'object' ? Object.keys(window.__GAME_API__) : [],
  };
})();
`;

/** Simulate basic player interactions based on engine type. */
const INTERACTION_SCRIPTS: Record<string, string> = {
  default: `
    // Simulate keyboard input: WASD movement for a few seconds
    async function simulatePlay() {
      const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];
      for (let i = 0; i < 20; i++) {
        const key = keys[i % keys.length];
        document.dispatchEvent(new KeyboardEvent('keydown', { code: key, bubbles: true }));
        await new Promise(r => setTimeout(r, 200));
        document.dispatchEvent(new KeyboardEvent('keyup', { code: key, bubbles: true }));
        await new Promise(r => setTimeout(r, 100));
      }
      // Click center of canvas
      const canvas = document.querySelector('canvas');
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new MouseEvent('click', {
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
        }));
      }
    }
    simulatePlay();
  `,
};

export function createGamePlaytestTool(ctx: ToolContext) {
  return tool({
    description:
      "Automated playtest: builds the game, launches it in a headless browser, " +
      "simulates player input, captures screenshots and performance metrics. " +
      "Returns a structured PlaytestResult with FPS, errors, and observations.",
    parameters: z.object({
      gameId: z.string().describe("The game ID to playtest"),
      durationSeconds: z
        .number()
        .optional()
        .describe("How long to playtest in seconds (default: 10)"),
      captureScreenshots: z
        .boolean()
        .optional()
        .describe("Capture before/after screenshots (default: true)"),
    }),
    execute: async ({ gameId, durationSeconds, captureScreenshots }) => {
      const game = getGame(ctx.workspacePath, gameId);
      if (!game) return JSON.stringify({ error: `Game ${gameId} not found` });

      const duration = durationSeconds ?? 10;
      const doScreenshots = captureScreenshots !== false;

      // 1. Build the game
      const buildResult = buildGame(ctx.workspacePath, gameId);
      if (!buildResult.ok) {
        return JSON.stringify({ error: `Build failed: ${buildResult.error}` });
      }

      // 2. Start a temporary static server
      let distPath = getGameDistPath(ctx.workspacePath, gameId);
      if (!distPath) distPath = getGameSourcePath(ctx.workspacePath, gameId);
      if (!distPath) return JSON.stringify({ error: "Game build path not found" });

      const port = await findFreePort();
      const server = startStaticServer(distPath, port);
      const url = `http://localhost:${port}`;

      let result: PlaytestResult;

      try {
        // 3. Launch browser
        const { getBrowser } = await import("./browser-pool.js");
        const browser = await getBrowser();
        const context = await browser.newContext({
          viewport: { width: 1280, height: 720 },
        });
        const page = await context.newPage();

        const loadStart = Date.now();

        // 4. Navigate to game
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

        // 5. Inject instrumentation
        await page.evaluate(INSTRUMENTATION_SCRIPT);

        // Wait for game to initialize
        await page.waitForTimeout(2000);

        const loadTimeMs = Date.now() - loadStart;

        // 6. Capture initial screenshot
        const screenshotDir = path.join(ctx.workspacePath, "games", gameId, "playtest-screenshots");
        const screenshotPaths: string[] = [];

        if (doScreenshots) {
          fs.mkdirSync(screenshotDir, { recursive: true });
          const beforePath = path.join(screenshotDir, `before_${nanoid(6)}.png`);
          await page.screenshot({ path: beforePath, type: "png" });
          screenshotPaths.push(beforePath);
        }

        // 7. Simulate interactions
        const interactionScript = INTERACTION_SCRIPTS.default;
        await page.evaluate(interactionScript);

        // 8. Wait for remaining duration
        const elapsedMs = Date.now() - loadStart;
        const remainingMs = Math.max(0, duration * 1000 - elapsedMs);
        if (remainingMs > 0) {
          await page.waitForTimeout(remainingMs);
        }

        // 9. Capture final screenshot
        if (doScreenshots) {
          const afterPath = path.join(screenshotDir, `after_${nanoid(6)}.png`);
          await page.screenshot({ path: afterPath, type: "png" });
          screenshotPaths.push(afterPath);
        }

        // 10. Collect metrics
        const metrics = await page.evaluate(() => {
          return (window as any).__PLAYTEST__?.getMetrics?.() ?? {
            avgFps: 0, minFps: 0, frameCount: 0, memoryUsageMb: 0,
          };
        });

        const errors = await page.evaluate(() => {
          return (window as any).__PLAYTEST__?.getErrors?.() ?? [];
        }) as string[];

        const gameState = await page.evaluate(() => {
          return (window as any).__PLAYTEST__?.getGameState?.() ?? null;
        });

        const gameAPIKeys = await page.evaluate(() => {
          return (window as any).__PLAYTEST__?.getGameAPI?.() ?? [];
        }) as string[];

        // 11. Detect bugs
        const bugs: PlaytestBug[] = [];

        if (metrics.avgFps < 30) {
          bugs.push({
            description: `Low average FPS: ${metrics.avgFps}`,
            severity: metrics.avgFps < 15 ? "critical" : "major",
          });
        }

        if (metrics.minFps < 10) {
          bugs.push({
            description: `FPS drops below 10 (min: ${metrics.minFps})`,
            severity: "major",
          });
        }

        for (const err of errors) {
          bugs.push({
            description: `Console error: ${err.slice(0, 200)}`,
            severity: err.toLowerCase().includes("uncaught") ? "critical" : "minor",
          });
        }

        if (metrics.frameCount === 0) {
          bugs.push({
            description: "No animation frames detected — game loop may not be running",
            severity: "critical",
          });
        }

        // 12. Build observations
        const observations: string[] = [];
        observations.push(`Engine: ${game.engine}`);
        observations.push(`Load time: ${loadTimeMs}ms`);
        observations.push(`Frames rendered: ${metrics.frameCount}`);
        observations.push(`Avg FPS: ${metrics.avgFps}, Min FPS: ${metrics.minFps}`);
        if (metrics.memoryUsageMb > 0) {
          observations.push(`Memory usage: ${metrics.memoryUsageMb}MB`);
        }
        if (gameState) {
          observations.push(`Game state available: ${JSON.stringify(gameState).slice(0, 200)}`);
        }
        if (gameAPIKeys.length > 0) {
          observations.push(`Game API methods: ${gameAPIKeys.join(", ")}`);
        }
        if (errors.length > 0) {
          observations.push(`Console errors: ${errors.length}`);
        }
        if (screenshotPaths.length > 0) {
          observations.push(`Screenshots saved to: playtest-screenshots/`);
        }

        const perfMetrics: PerformanceMetrics = {
          avgFps: metrics.avgFps,
          minFps: metrics.minFps,
          loadTimeMs,
          memoryUsageMb: metrics.memoryUsageMb,
        };

        result = {
          id: nanoid(12),
          gameId,
          timestamp: new Date().toISOString(),
          duration: duration,
          completedObjectives: [
            "Game loaded successfully",
            ...(metrics.frameCount > 0 ? ["Game loop running"] : []),
            ...(metrics.avgFps >= 30 ? ["Acceptable frame rate (≥30 FPS)"] : []),
            ...(errors.length === 0 ? ["No console errors"] : []),
          ],
          failedObjectives: [
            ...(metrics.frameCount === 0 ? ["Game loop not detected"] : []),
            ...(metrics.avgFps < 30 && metrics.avgFps > 0 ? ["Low frame rate (<30 FPS)"] : []),
            ...(errors.length > 0 ? [`${errors.length} console error(s)`] : []),
          ],
          bugs,
          performanceMetrics: perfMetrics,
          agentObservations: observations.join("\n"),
        };

        // Clean up
        await context.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result = {
          id: nanoid(12),
          gameId,
          timestamp: new Date().toISOString(),
          duration: 0,
          completedObjectives: [],
          failedObjectives: ["Playtest failed to complete"],
          bugs: [{ description: `Playtest error: ${message}`, severity: "critical" }],
          performanceMetrics: { avgFps: 0, minFps: 0, loadTimeMs: 0, memoryUsageMb: 0 },
          agentObservations: `Playtest failed: ${message}`,
        };
      } finally {
        server.close();
      }

      return JSON.stringify(result, null, 2);
    },
  });
}
