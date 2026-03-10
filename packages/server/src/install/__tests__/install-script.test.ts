import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = process.cwd();
const INSTALL_SCRIPT = join(REPO_ROOT, "install.sh");

type ScriptResult = ReturnType<typeof spawnSync>;

function makeTempDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

function createStubCommand(binDir: string, name: string, body: string) {
  const path = join(binDir, name);
  writeFileSync(path, `#!/bin/sh\nset -eu\n${body}\n`, "utf8");
  chmodSync(path, 0o755);
}

function setupStubBin(logFile: string) {
  const binDir = makeTempDir("otterbot-install-bin");

  createStubCommand(
    binDir,
    "docker",
    `
printf 'docker:%s %s %s\\n' "${'$'}{1:-}" "${'$'}{2:-}" "${'$'}{3:-}" >> "${logFile}"
if [ "${'$'}#" -ge 1 ] && [ "${'$'}1" = "info" ]; then
  exit 0
fi
if [ "${'$'}#" -ge 2 ] && [ "${'$'}1" = "compose" ] && [ "${'$'}2" = "version" ]; then
  exit 0
fi
if [ "${'$'}#" -ge 2 ] && [ "${'$'}1" = "compose" ] && [ "${'$'}2" = "pull" ]; then
  exit 0
fi
if [ "${'$'}#" -ge 3 ] && [ "${'$'}1" = "compose" ] && [ "${'$'}2" = "up" ] && [ "${'$'}3" = "-d" ]; then
  exit 0
fi
exit 0`
  );

  createStubCommand(
    binDir,
    "open",
    `
printf 'open:%s\\n' "${'$'}{1:-}" >> "${logFile}"
exit 0`
  );

  createStubCommand(
    binDir,
    "openssl",
    `
if [ "${'$'}#" -eq 2 ] && [ "${'$'}1" = "rand" ] && [ "${'$'}2" = "-hex" ]; then
  echo deadbeefdeadbeefdeadbeefdeadbeef
  exit 0
fi
if [ "${'$'}#" -eq 3 ] && [ "${'$'}1" = "rand" ] && [ "${'$'}2" = "-hex" ] && [ "${'$'}3" = "16" ]; then
  echo deadbeefdeadbeefdeadbeefdeadbeef
  exit 0
fi
echo deadbeefdeadbeefdeadbeefdeadbeef`
  );

  return binDir;
}

function runInstall(args: string[], env: NodeJS.ProcessEnv): ScriptResult {
  return spawnSync("sh", [INSTALL_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
  });
}

describe("install.sh browser opening", () => {
  it("shows --no-open in help output", () => {
    const result = runInstall(["--help"], process.env);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--no-open");
  });

  it("opens browser after start by default when opener exists", () => {
    const tempRoot = makeTempDir("otterbot-install-test");
    const logFile = join(tempRoot, "calls.log");
    const installDir = join(tempRoot, "install");
    const binDir = setupStubBin(logFile);

    const result = runInstall([], {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      OTTERBOT_DIR: installDir,
      HOME: tempRoot,
    });

    try {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Otterbot is installed!");
      expect(result.stdout).toContain("Opened browser to https://localhost:62626");

      const calls = readFileSync(logFile, "utf8");
      expect(calls).toContain("docker:info");
      expect(calls).toContain("docker:compose");
      expect(calls).toContain("open:https://localhost:62626");
      expect(existsSync(join(installDir, ".env"))).toBe(true);
      expect(existsSync(join(installDir, "docker-compose.yml"))).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it("does not open browser with --no-open", () => {
    const tempRoot = makeTempDir("otterbot-install-test");
    const logFile = join(tempRoot, "calls.log");
    const installDir = join(tempRoot, "install");
    const binDir = setupStubBin(logFile);

    const result = runInstall(["--no-open"], {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      OTTERBOT_DIR: installDir,
      HOME: tempRoot,
    });

    try {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Otterbot is installed!");
      expect(result.stdout).not.toContain("Opened browser to https://localhost:62626");

      const calls = readFileSync(logFile, "utf8");
      expect(calls).not.toContain("open:https://localhost:62626");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it("does not open browser when --no-start is provided", () => {
    const tempRoot = makeTempDir("otterbot-install-test");
    const logFile = join(tempRoot, "calls.log");
    const installDir = join(tempRoot, "install");
    const binDir = setupStubBin(logFile);

    const result = runInstall(["--no-start"], {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      OTTERBOT_DIR: installDir,
      HOME: tempRoot,
    });

    try {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Skipping pull & start (--no-start)");
      expect(result.stdout).not.toContain("Opened browser to https://localhost:62626");

      const calls = readFileSync(logFile, "utf8");
      expect(calls).not.toContain("docker:compose pull");
      expect(calls).not.toContain("docker:compose up -d");
      expect(calls).not.toContain("open:https://localhost:62626");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});
