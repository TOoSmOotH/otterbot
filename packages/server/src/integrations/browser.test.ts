import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  browserClick,
  browserEnvFor,
  browserNavigate,
  browserSnapshot,
  browserType,
  type BrowserEnv,
} from "./browser.js";

/**
 * End-to-end test of the agent-browser integration against a tiny local page.
 * Skipped automatically when the browser engine isn't ready (no Chrome
 * downloaded), so CI without `agent-browser install` stays green; it runs
 * locally where Chrome is present.
 */

function resolveBin(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("agent-browser/package.json");
    const pkg = require("agent-browser/package.json") as { bin?: string | Record<string, string> };
    const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["agent-browser"];
    return rel ? join(pkgPath, "..", rel) : null;
  } catch {
    return null;
  }
}

const BIN = resolveBin();

function engineReady(): boolean {
  if (!BIN) return false;
  // `doctor` exits non-zero when Chrome isn't installed.
  try {
    return spawnSync(process.execPath, [BIN, "doctor"], { timeout: 20_000 }).status === 0;
  } catch {
    return false;
  }
}

const ready = engineReady();
const PAGE = `<!doctype html><html><head><title>Otter Test</title></head><body>
  <h1 id="hdr">Hello Otter</h1>
  <input id="box" aria-label="Name" />
  <a href="/next" id="go">Go next</a>
</body></html>`;

describe.skipIf(!ready)("agent-browser integration", () => {
  let server: Server;
  let baseUrl: string;
  let dir: string;
  // Each test gets its own session + profile so a shared daemon can't race
  // them when the suite runs many test files (and real Chrome) in parallel.
  let nextId = 0;
  const makeEnv = (): BrowserEnv =>
    browserEnvFor(`test-agent-${nextId}`, join(dir, `browser-${nextId++}`));

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(req.url === "/next" ? "<h1>Second page</h1>" : PAGE);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}/`;
    dir = mkdtempSync(join(tmpdir(), "otter-browser-test-"));
  }, 60_000);

  afterAll(async () => {
    // Reap every daemon synchronously — the fire-and-forget closeBrowserSession
    // would lose the race with the test process exiting.
    if (BIN) spawnSync(process.execPath, [BIN, "close", "--all"], { timeout: 20_000 });
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });

  // Retry: real Chrome under heavy parallel CPU load can hiccup transiently;
  // the integration itself is deterministic (passes consistently in isolation).
  it("navigates and snapshots the page with refs", { retry: 2, timeout: 60_000 }, async () => {
    const env = makeEnv();
    const nav = await browserNavigate(env, baseUrl);
    expect(nav.ok).toBe(true);

    const snap = await browserSnapshot(env, { interactive: false });
    expect(snap.ok).toBe(true);
    // The snapshot carries an accessibility tree mentioning the heading.
    expect(JSON.stringify(snap.ok && snap.result)).toContain("Hello Otter");
  });

  it("types into an input and clicks a link", { retry: 2, timeout: 60_000 }, async () => {
    const env = makeEnv();
    await browserNavigate(env, baseUrl);
    const typed = await browserType(env, "#box", "otters");
    expect(typed.ok).toBe(true);

    const clicked = await browserClick(env, "#go");
    expect(clicked.ok).toBe(true);
  });
});

describe("browserEnvFor", () => {
  it("carries an explicit per-call timeout", () => {
    const env = browserEnvFor("agent-x", "/tmp/profile", 180_000);
    expect(env.timeoutMs).toBe(180_000);
  });
  it("leaves timeout unset when none is given", () => {
    const env = browserEnvFor("agent-x", "/tmp/profile");
    expect(env.timeoutMs).toBeUndefined();
  });
});
