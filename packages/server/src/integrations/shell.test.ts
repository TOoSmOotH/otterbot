import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureWorkspace, buildSandboxPlan } from "./shell.js";

describe("ensureWorkspace", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-ws-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates bin/ and seeds the shell dotfiles", () => {
    ensureWorkspace(dir);
    expect(existsSync(join(dir, "bin"))).toBe(true);
    expect(existsSync(join(dir, ".bashrc"))).toBe(true);
    expect(existsSync(join(dir, ".bash_profile"))).toBe(true);
    expect(existsSync(join(dir, ".profile"))).toBe(true);
    // .bashrc puts ~/bin on PATH; the login profiles source .bashrc.
    expect(readFileSync(join(dir, ".bashrc"), "utf8")).toContain('$HOME/bin');
    expect(readFileSync(join(dir, ".bash_profile"), "utf8")).toContain(".bashrc");
  });

  it("never clobbers a user-edited dotfile", () => {
    writeFileSync(join(dir, ".bashrc"), "# my own config\n");
    ensureWorkspace(dir);
    expect(readFileSync(join(dir, ".bashrc"), "utf8")).toBe("# my own config\n");
  });
});

describe("buildSandboxPlan PATH", () => {
  it("puts ~/bin first on PATH so installed tools resolve", () => {
    const dir = mkdtempSync(join(tmpdir(), "otter-ws-"));
    try {
      const built = buildSandboxPlan(dir, new Map(), ["/bin/sh", "-c", "true"]);
      // No OS sandbox available in this environment — nothing to assert.
      if ("error" in built) return;

      const { plan } = built;
      // bwrap passes env via `--setenv KEY VALUE`; sandbox-exec via plan.env.
      const args = plan.args;
      const i = args.indexOf("PATH");
      const path =
        i >= 0 && args[i - 1] === "--setenv"
          ? args[i + 1]
          : (plan.env as Record<string, string>).PATH;
      // HOME inside the bwrap sandbox is /workspace; sandbox-exec uses the real dir.
      expect(path.startsWith("/workspace/bin:") || path.startsWith(`${dir}/bin:`)).toBe(
        true
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
