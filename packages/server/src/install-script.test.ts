import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type RunOptions = {
  args?: string[];
  env?: Record<string, string | undefined>;
  commands?: Record<string, string>;
};

const REPO_ROOT = resolve(process.cwd());
const INSTALL_SCRIPT = join(REPO_ROOT, "install.sh");
const TEST_URL = "https://localhost:62626";
const tmpRoots: string[] = [];

function addExecutable(binDir: string, name: string, scriptBody: string): void {
  const filePath = join(binDir, name);
  writeFileSync(filePath, scriptBody);
  chmodSync(filePath, 0o755);
}

function runInstallScript(options: RunOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "otterbot-install-test-"));
  tmpRoots.push(root);

  const binDir = join(root, "bin");
  const homeDir = join(root, "home");
  const installDir = join(root, "install-dir");
  const logPath = join(root, "commands.log");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });

  const dockerStub = `#!/bin/sh
echo "docker $*" >> "$TEST_LOG"
exit 0
`;
  addExecutable(binDir, "docker", dockerStub);

  for (const [name, body] of Object.entries(options.commands ?? {})) {
    addExecutable(binDir, name, body);
  }

  const env = {
    ...process.env,
    HOME: homeDir,
    OTTERBOT_DIR: installDir,
    TEST_LOG: logPath,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    ...options.env,
  };

  const result = spawnSync("sh", [INSTALL_SCRIPT, ...(options.args ?? [])], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env,
  });

  const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  return { result, log, installDir };
}

afterEach(() => {
  for (const dir of tmpRoots.splice(0, tmpRoots.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("install.sh browser opening", () => {
  it("opens with open when available", () => {
    const openStub = `#!/bin/sh
echo "open $*" >> "$TEST_LOG"
exit 0
`;
    const { result, log } = runInstallScript({
      commands: { open: openStub },
    });

    expect(result.status).toBe(0);
    expect(log).toContain(`open ${TEST_URL}`);
    expect(result.stdout).toContain(`Opened browser to ${TEST_URL}`);
  });

  it("does not try to open a browser when --no-open is set", () => {
    const openStub = `#!/bin/sh
echo "open $*" >> "$TEST_LOG"
exit 0
`;
    const { result, log } = runInstallScript({
      args: ["--no-open"],
      commands: { open: openStub },
    });

    expect(result.status).toBe(0);
    expect(log).not.toContain("open ");
    expect(result.stdout).not.toContain("Opened browser to");
  });

  it("uses xdg-open when running with a display and open is not available", () => {
    const openFailStub = `#!/bin/sh
exit 1
`;
    const xdgOpenStub = `#!/bin/sh
echo "xdg-open $*" >> "$TEST_LOG"
exit 0
`;
    const { result, log } = runInstallScript({
      env: { DISPLAY: ":0" },
      commands: { open: openFailStub, "xdg-open": xdgOpenStub },
    });

    expect(result.status).toBe(0);
    expect(log).toContain(`xdg-open ${TEST_URL}`);
    expect(result.stdout).toContain(`Opened browser to ${TEST_URL}`);
  });

  it("falls back to wslview when no display opener is available", () => {
    const openFailStub = `#!/bin/sh
exit 1
`;
    const wslviewStub = `#!/bin/sh
echo "wslview $*" >> "$TEST_LOG"
exit 0
`;
    const { result, log } = runInstallScript({
      env: {
        DISPLAY: "",
        WAYLAND_DISPLAY: "",
      },
      commands: { open: openFailStub, wslview: wslviewStub },
    });

    expect(result.status).toBe(0);
    expect(log).toContain(`wslview ${TEST_URL}`);
    expect(result.stdout).toContain(`Opened browser to ${TEST_URL}`);
  });
});

describe("install.sh architecture platform detection", () => {
  it("writes linux/amd64 platform for x86_64", () => {
    const unameStub = `#!/bin/sh
if [ "$1" = "-s" ]; then
  echo "Linux"
  exit 0
fi
if [ "$1" = "-m" ]; then
  echo "x86_64"
  exit 0
fi
exit 1
`;
    const { result, installDir } = runInstallScript({
      args: ["--no-start", "--no-open"],
      commands: { uname: unameStub },
    });

    const compose = readFileSync(join(installDir, "docker-compose.yml"), "utf8");
    expect(result.status).toBe(0);
    expect(compose).toContain("platform: linux/amd64");
    expect(result.stdout).toContain("platform: linux/amd64");
  });

  it("writes linux/arm64 platform for arm64", () => {
    const unameStub = `#!/bin/sh
if [ "$1" = "-s" ]; then
  echo "Linux"
  exit 0
fi
if [ "$1" = "-m" ]; then
  echo "arm64"
  exit 0
fi
exit 1
`;
    const { result, installDir } = runInstallScript({
      args: ["--no-start", "--no-open"],
      commands: { uname: unameStub },
    });

    const compose = readFileSync(join(installDir, "docker-compose.yml"), "utf8");
    expect(result.status).toBe(0);
    expect(compose).toContain("platform: linux/arm64");
    expect(result.stdout).toContain("platform: linux/arm64");
  });

  it("fails for unsupported architectures", () => {
    const unameStub = `#!/bin/sh
if [ "$1" = "-s" ]; then
  echo "Linux"
  exit 0
fi
if [ "$1" = "-m" ]; then
  echo "sparc"
  exit 0
fi
exit 1
`;
    const { result } = runInstallScript({
      commands: { uname: unameStub },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unsupported architecture: sparc");
  });
});
