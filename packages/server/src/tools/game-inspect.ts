/**
 * Game state inspection tool.
 *
 * Reads window.__GAME_STATE__ and window.__GAME_API__ from a running game
 * to provide structured scene and player state information. Can also
 * call game API methods for programmatic interaction.
 *
 * Requires a game preview server to be running (use game_preview first).
 */

import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tool-context.js";
import { getGame } from "../games/game-service.js";

export function createGameInspectTool(ctx: ToolContext) {
  return tool({
    description:
      "Inspect a running game's state by reading window.__GAME_STATE__ and " +
      "window.__GAME_API__. Can also call game API methods. " +
      "Requires the game to be running in a browser (use game_playtest or game_preview first). " +
      "Pass a previewUrl to connect to the game.",
    parameters: z.object({
      gameId: z.string().describe("The game ID to inspect"),
      previewUrl: z.string().describe("The URL where the game is running (from game_preview)"),
      action: z
        .enum(["state", "api", "call", "screenshot", "evaluate"])
        .optional()
        .describe("Action: state (read __GAME_STATE__), api (list API methods), call (invoke an API method), screenshot, evaluate (run custom JS)"),
      method: z.string().optional().describe("API method name (for 'call' action)"),
      args: z.array(z.unknown()).optional().describe("Arguments for API method call"),
      script: z.string().optional().describe("Custom JavaScript to evaluate (for 'evaluate' action)"),
    }),
    execute: async ({ gameId, previewUrl, action, method, args, script }) => {
      const game = getGame(ctx.workspacePath, gameId);
      if (!game) return JSON.stringify({ error: `Game ${gameId} not found` });

      const inspectAction = action ?? "state";

      try {
        const { getBrowser } = await import("./browser-pool.js");
        const browser = await getBrowser();
        const context = await browser.newContext({
          viewport: { width: 1280, height: 720 },
        });
        const page = await context.newPage();

        await page.goto(previewUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

        // Wait for game to initialize
        await page.waitForTimeout(2000);

        let result: unknown;

        switch (inspectAction) {
          case "state": {
            result = await page.evaluate(() => {
              const state = (window as any).__GAME_STATE__;
              if (!state) return { error: "No __GAME_STATE__ found. The game may not expose state." };
              return state;
            });
            break;
          }

          case "api": {
            result = await page.evaluate(() => {
              const api = (window as any).__GAME_API__;
              if (!api || typeof api !== "object") {
                return { error: "No __GAME_API__ found.", available: false };
              }
              const methods: Record<string, string> = {};
              for (const key of Object.keys(api)) {
                methods[key] = typeof api[key];
              }
              return { available: true, methods };
            });
            break;
          }

          case "call": {
            if (!method) {
              result = { error: "method parameter required for 'call' action" };
              break;
            }
            result = await page.evaluate(
              ({ method, args }) => {
                const api = (window as any).__GAME_API__;
                if (!api || typeof api[method] !== "function") {
                  return { error: `Method '${method}' not found in __GAME_API__` };
                }
                try {
                  const ret = api[method](...(args || []));
                  return { ok: true, result: ret };
                } catch (e: any) {
                  return { error: `Method threw: ${e.message}` };
                }
              },
              { method, args: args ?? [] },
            );
            break;
          }

          case "screenshot": {
            const fs = await import("node:fs");
            const path = await import("node:path");
            const { nanoid } = await import("nanoid");

            const screenshotDir = path.join(ctx.workspacePath, "games", gameId, "inspect-screenshots");
            fs.mkdirSync(screenshotDir, { recursive: true });

            const filename = `inspect_${nanoid(6)}.png`;
            const filePath = path.join(screenshotDir, filename);
            await page.screenshot({ path: filePath, type: "png" });

            result = {
              ok: true,
              path: `games/${gameId}/inspect-screenshots/${filename}`,
              message: "Screenshot captured",
            };
            break;
          }

          case "evaluate": {
            if (!script) {
              result = { error: "script parameter required for 'evaluate' action" };
              break;
            }
            try {
              const evalResult = await page.evaluate(script);
              result = { ok: true, result: evalResult };
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : String(e);
              result = { error: `Evaluation failed: ${message}` };
            }
            break;
          }
        }

        await context.close();

        return JSON.stringify({
          gameId,
          engine: game.engine,
          action: inspectAction,
          data: result,
        }, null, 2);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: `Inspection failed: ${message}` });
      }
    },
  });
}
