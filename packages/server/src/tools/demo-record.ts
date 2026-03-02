/**
 * Demo recording tool — records video demos of running web applications
 * with optional TTS voiceover narration.
 *
 * Uses Playwright's recordVideo for browser capture, the existing TTS system
 * for narration, and FFmpeg for post-processing into YouTube-ready MP4.
 *
 * Integrates with web_browse via session injection: when recording starts,
 * the recording-enabled browser context is injected into web_browse's session
 * map so all subsequent web_browse actions are captured in the video.
 */

import { tool } from "ai";
import { z } from "zod";
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { ToolContext } from "./tool-context.js";
import {
  createRecordingBrowserContext,
  getViewportFromResolution,
} from "./browser-pool.js";
import { injectSession, detachSession } from "./web-browse.js";
import {
  mergeVideoAndNarration,
  convertToMp4,
  getAudioDurationMs,
  type NarrationSegment,
} from "./demo-ffmpeg.js";
import { getConfiguredTTSProvider } from "../tts/tts.js";
import { getConfig } from "../auth/auth.js";

// ---------------------------------------------------------------------------
// Per-agent recording session state
// ---------------------------------------------------------------------------

interface RecordingSession {
  context: BrowserContext;
  page: Page;
  videoDir: string;
  outputDir: string;
  startedAt: number;
  narrationSegments: NarrationSegment[];
}

const recordingSessions: Map<string, RecordingSession> = new Map();

// Clean up leaked sessions after 30 minutes
const SESSION_MAX_AGE = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [agentId, session] of recordingSessions) {
    if (now - session.startedAt > SESSION_MAX_AGE) {
      console.warn(`[demo-record] Cleaning up stale recording session for agent ${agentId}`);
      session.context.close().catch(() => {});
      recordingSessions.delete(agentId);
    }
  }
}, 60_000);

// ---------------------------------------------------------------------------
// Resolution presets
// ---------------------------------------------------------------------------

const RESOLUTION_PRESETS: Record<string, { width: number; height: number }> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
};

// ---------------------------------------------------------------------------
// TTS helper
// ---------------------------------------------------------------------------

async function synthesizeNarration(
  text: string,
  outputPath: string,
): Promise<number> {
  const provider = getConfiguredTTSProvider();
  if (!provider) {
    throw new Error(
      "No TTS provider configured. Configure one in Settings → Speech to enable narration.",
    );
  }

  const voice = getConfig("tts:voice") ?? "af_heart";
  const speed = parseFloat(getConfig("tts:speed") ?? "1.0") || 1.0;

  const { audio } = await provider.synthesize(text, voice, speed);
  writeFileSync(outputPath, audio);

  return getAudioDurationMs(outputPath);
}

// ---------------------------------------------------------------------------
// Script execution helper
// ---------------------------------------------------------------------------

const scriptStepSchema = z.object({
  narration: z.string().optional().describe("Text to narrate via TTS"),
  actions: z.array(
    z.object({
      type: z.enum(["navigate", "click", "fill", "wait", "screenshot"]),
      url: z.string().optional(),
      selector: z.string().optional(),
      value: z.string().optional(),
      seconds: z.number().optional(),
    }),
  ).describe("Browser actions to perform"),
  waitAfter: z.number().optional().describe("Seconds to pause after actions (default: 1.5)"),
});

type DemoStep = z.infer<typeof scriptStepSchema>;

async function executeScriptStep(
  session: RecordingSession,
  step: DemoStep,
  agentId: string,
): Promise<string> {
  const results: string[] = [];

  // Narrate first (so audio plays over the actions visually)
  if (step.narration) {
    const timestamp = Date.now() - session.startedAt;
    const audioPath = resolve(
      session.videoDir,
      `narration-${session.narrationSegments.length}.audio`,
    );
    const duration = await synthesizeNarration(step.narration, audioPath);
    session.narrationSegments.push({ timestamp, audioPath, duration });
    results.push(`Narrated: "${step.narration.slice(0, 80)}${step.narration.length > 80 ? "..." : ""}"`);

    // Wait for narration duration so the video has time for the audio
    await session.page.waitForTimeout(duration);
  }

  // Execute each action
  for (const action of step.actions) {
    switch (action.type) {
      case "navigate": {
        if (!action.url) {
          results.push("Skip navigate: no URL");
          break;
        }
        await session.page.goto(action.url, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        const title = await session.page.title();
        results.push(`Navigated to "${title}"`);
        break;
      }
      case "click": {
        if (!action.selector) {
          results.push("Skip click: no selector");
          break;
        }
        await session.page.click(action.selector, { timeout: 10_000 });
        await session.page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
        results.push(`Clicked "${action.selector}"`);
        break;
      }
      case "fill": {
        if (!action.selector || action.value === undefined) {
          results.push("Skip fill: missing selector or value");
          break;
        }
        await session.page.fill(action.selector, action.value, { timeout: 10_000 });
        results.push(`Filled "${action.selector}"`);
        break;
      }
      case "wait": {
        const seconds = action.seconds ?? 1;
        await session.page.waitForTimeout(seconds * 1000);
        results.push(`Waited ${seconds}s`);
        break;
      }
      case "screenshot": {
        // Screenshots during recording are implicit (captured in video)
        results.push("Screenshot captured (in video)");
        break;
      }
    }
  }

  // Pause after the step for pacing
  const waitAfter = step.waitAfter ?? 1.5;
  if (waitAfter > 0) {
    await session.page.waitForTimeout(waitAfter * 1000);
  }

  return results.join("; ");
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function createDemoRecordTool(ctx: ToolContext) {
  return tool({
    description:
      "Record a video demo of a web application with optional voiceover narration. " +
      "Use 'start' to begin recording at a URL, 'narrate' to add voiceover, " +
      "'wait' for pacing pauses, 'run_script' for scripted demos, and 'stop' to " +
      "finalize the video. Between start and stop, use web_browse to interact " +
      "with the page — all interactions are captured in the video.",
    parameters: z.object({
      action: z
        .enum(["start", "narrate", "wait", "stop", "run_script", "status"])
        .describe("The recording action to perform"),
      url: z
        .string()
        .optional()
        .describe("URL to navigate to (required for 'start')"),
      text: z
        .string()
        .optional()
        .describe("Narration text (required for 'narrate')"),
      seconds: z
        .number()
        .optional()
        .describe("Duration in seconds (for 'wait', default: 2)"),
      resolution: z
        .enum(["720p", "1080p"])
        .optional()
        .describe("Video resolution (for 'start', default: from env or 720p)"),
      filename: z
        .string()
        .optional()
        .describe("Output filename without extension (for 'stop', default: 'demo')"),
      script: z
        .string()
        .optional()
        .describe(
          "JSON array of demo steps for 'run_script'. Each step: " +
          '{ narration?: string, actions: [{ type, url?, selector?, value?, seconds? }], waitAfter?: number }',
        ),
    }),
    execute: async ({ action, url, text, seconds, resolution, filename, script }) => {
      try {
        switch (action) {
          // ---------------------------------------------------------------
          // START
          // ---------------------------------------------------------------
          case "start": {
            if (!url) return "Error: url is required for start action.";
            if (recordingSessions.has(ctx.agentId)) {
              return "Error: A recording is already in progress. Stop it first.";
            }

            // Create temp dir for Playwright video and output dir for final MP4
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const videoDir = resolve(ctx.workspacePath, ".demo-recordings", timestamp);
            const outputDir = resolve(ctx.workspacePath, "recordings");
            mkdirSync(videoDir, { recursive: true });
            mkdirSync(outputDir, { recursive: true });

            // Resolve video size
            const preset = resolution ? RESOLUTION_PRESETS[resolution] : undefined;
            const videoSize = preset ?? getViewportFromResolution();

            // Create recording browser context and navigate
            const context = await createRecordingBrowserContext(videoDir, videoSize);
            const page = await context.newPage();
            await page.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: 30_000,
            });

            const session: RecordingSession = {
              context,
              page,
              videoDir,
              outputDir,
              startedAt: Date.now(),
              narrationSegments: [],
            };
            recordingSessions.set(ctx.agentId, session);

            // Inject into web_browse so subsequent web_browse calls use this page
            await injectSession(ctx.agentId, context, page);

            const title = await page.title();
            const res = `${videoSize.width}x${videoSize.height}`;
            return (
              `Recording started at "${title}" (${page.url()}) [${res}]. ` +
              `Use web_browse to interact with the page — all actions are captured. ` +
              `Use demo_record narrate to add voiceover. Call demo_record stop when done.`
            );
          }

          // ---------------------------------------------------------------
          // NARRATE
          // ---------------------------------------------------------------
          case "narrate": {
            if (!text) return "Error: text is required for narrate action.";
            const session = recordingSessions.get(ctx.agentId);
            if (!session) return "Error: No recording in progress. Call start first.";

            const timestamp = Date.now() - session.startedAt;
            const audioPath = resolve(
              session.videoDir,
              `narration-${session.narrationSegments.length}.audio`,
            );

            const duration = await synthesizeNarration(text, audioPath);
            session.narrationSegments.push({ timestamp, audioPath, duration });

            // Pause in the video for the narration duration
            await session.page.waitForTimeout(duration);

            return (
              `Narration added at ${(timestamp / 1000).toFixed(1)}s ` +
              `(${(duration / 1000).toFixed(1)}s audio): "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"`
            );
          }

          // ---------------------------------------------------------------
          // WAIT
          // ---------------------------------------------------------------
          case "wait": {
            const session = recordingSessions.get(ctx.agentId);
            if (!session) return "Error: No recording in progress.";

            const waitSec = seconds ?? 2;
            await session.page.waitForTimeout(waitSec * 1000);
            return `Paused ${waitSec}s in recording.`;
          }

          // ---------------------------------------------------------------
          // RUN_SCRIPT
          // ---------------------------------------------------------------
          case "run_script": {
            if (!script) return "Error: script is required for run_script action.";
            const session = recordingSessions.get(ctx.agentId);
            if (!session) return "Error: No recording in progress. Call start first.";

            let steps: DemoStep[];
            try {
              const parsed = JSON.parse(script);
              steps = z.array(scriptStepSchema).parse(parsed);
            } catch (err) {
              return `Error: Invalid script JSON: ${err instanceof Error ? err.message : String(err)}`;
            }

            const results: string[] = [];
            for (let i = 0; i < steps.length; i++) {
              const stepResult = await executeScriptStep(session, steps[i], ctx.agentId);
              results.push(`Step ${i + 1}: ${stepResult}`);
            }

            return `Script completed (${steps.length} steps).\n${results.join("\n")}`;
          }

          // ---------------------------------------------------------------
          // STOP
          // ---------------------------------------------------------------
          case "stop": {
            const session = recordingSessions.get(ctx.agentId);
            if (!session) return "Error: No recording in progress.";

            // Detach from web_browse (don't let it close the context)
            detachSession(ctx.agentId);

            // Get the video path before closing
            const video = session.page.video();

            // Close page then context — this finalizes the WebM video
            await session.page.close();
            await session.context.close();

            // Find the recorded WebM file
            let webmPath: string | null = null;
            if (video) {
              try {
                webmPath = await video.path();
              } catch {
                // video.path() can throw if the video wasn't saved
              }
            }

            if (!webmPath) {
              // Fallback: find the WebM file in the video dir
              const files = readdirSync(session.videoDir).filter((f) => f.endsWith(".webm"));
              if (files.length > 0) {
                webmPath = resolve(session.videoDir, files[0]);
              }
            }

            if (!webmPath) {
              recordingSessions.delete(ctx.agentId);
              return "Error: No video file found. The recording may have failed.";
            }

            // Post-process: convert to MP4, merge narration if any
            const outputName = filename ?? "demo";
            const outputPath = resolve(session.outputDir, `${outputName}.mp4`);
            const durationSec = Math.round((Date.now() - session.startedAt) / 1000);

            try {
              if (session.narrationSegments.length > 0) {
                await mergeVideoAndNarration(webmPath, session.narrationSegments, outputPath);
              } else {
                await convertToMp4(webmPath, outputPath);
              }
            } catch (err) {
              recordingSessions.delete(ctx.agentId);
              const msg = err instanceof Error ? err.message : String(err);
              return (
                `Recording stopped (${durationSec}s) but FFmpeg post-processing failed: ${msg}\n` +
                `Raw WebM video is still available at: ${webmPath}`
              );
            }

            // Clean up temp files
            try {
              for (const seg of session.narrationSegments) {
                unlinkSync(seg.audioPath);
              }
              // Leave the WebM around in case the user needs it
            } catch {
              // Best-effort cleanup
            }

            recordingSessions.delete(ctx.agentId);

            const narrationInfo =
              session.narrationSegments.length > 0
                ? ` with ${session.narrationSegments.length} narration segment(s)`
                : " (silent)";

            return (
              `Recording stopped (${durationSec}s${narrationInfo}).\n` +
              `Video saved to: ${outputPath}\n` +
              `Raw WebM: ${webmPath}`
            );
          }

          // ---------------------------------------------------------------
          // STATUS
          // ---------------------------------------------------------------
          case "status": {
            const session = recordingSessions.get(ctx.agentId);
            if (!session) return "No recording in progress.";

            const elapsed = Math.round((Date.now() - session.startedAt) / 1000);
            const narrations = session.narrationSegments.length;
            return (
              `Recording in progress (${elapsed}s elapsed, ${narrations} narration segment(s)). ` +
              `Page: ${session.page.url()}`
            );
          }

          default:
            return `Unknown action: ${action}`;
        }
      } catch (err) {
        return `Demo recording error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
