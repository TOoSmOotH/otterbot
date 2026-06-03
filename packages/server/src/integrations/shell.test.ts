import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

describe("buildSandboxPlan project binding", () => {
  it("binds the project tree and starts there when requested", () => {
    const dir = mkdtempSync(join(tmpdir(), "otter-ws-"));
    const repo = mkdtempSync(join(tmpdir(), "otter-repo-"));
    try {
      const built = buildSandboxPlan(dir, new Map(), ["/bin/sh", "-c", "true"], {
        projectWorkspacePath: repo,
        startIn: "project",
      });
      if ("error" in built) return; // no OS sandbox here
      const { plan, sandbox } = built;
      if (sandbox === "bwrap") {
        // The project is bound at /project and the command chdirs there.
        const bindIdx = plan.args.indexOf(repo);
        expect(bindIdx).toBeGreaterThan(-1);
        expect(plan.args[bindIdx - 1]).toBe("--bind");
        expect(plan.args[bindIdx + 1]).toBe("/project");
        const chdirIdx = plan.args.indexOf("--chdir");
        expect(plan.args[chdirIdx + 1]).toBe("/project");
      } else {
        // sandbox-exec: no remap; the real repo path is the cwd.
        expect(plan.cwd).toBe(repo);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("leaves the start dir at /workspace when no project is bound", () => {
    const dir = mkdtempSync(join(tmpdir(), "otter-ws-"));
    try {
      const built = buildSandboxPlan(dir, new Map(), ["/bin/sh", "-c", "true"]);
      if ("error" in built) return;
      const { plan, sandbox } = built;
      if (sandbox === "bwrap") {
        const chdirIdx = plan.args.indexOf("--chdir");
        expect(plan.args[chdirIdx + 1]).toBe("/workspace");
        expect(plan.args).not.toContain("/project");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("binds the project read-only when projectReadOnly is set", () => {
    const dir = mkdtempSync(join(tmpdir(), "otter-ws-"));
    const repo = mkdtempSync(join(tmpdir(), "otter-repo-"));
    try {
      const built = buildSandboxPlan(dir, new Map(), ["/bin/sh", "-c", "true"], {
        projectWorkspacePath: repo,
        projectReadOnly: true,
      });
      if ("error" in built) return; // no OS sandbox here
      const { plan, sandbox } = built;
      if (sandbox === "bwrap") {
        const bindIdx = plan.args.indexOf(repo);
        expect(bindIdx).toBeGreaterThan(-1);
        expect(plan.args[bindIdx - 1]).toBe("--ro-bind");
        expect(plan.args[bindIdx + 1]).toBe("/project");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("binds the git SSH key read-only and sets GIT_SSH_COMMAND when gitSsh is set", () => {
    const dir = mkdtempSync(join(tmpdir(), "otter-ws-"));
    const key = join(mkdtempSync(join(tmpdir(), "otter-key-")), "id_ed25519");
    writeFileSync(key, "PRIVATE", { mode: 0o600 });
    try {
      const built = buildSandboxPlan(dir, new Map(), ["/bin/sh", "-c", "true"], {
        gitSsh: { keyPath: key },
      });
      if ("error" in built) return; // no OS sandbox here
      const { plan, sandbox } = built;
      if (sandbox === "bwrap") {
        const i = plan.args.indexOf(key);
        expect(i).toBeGreaterThan(-1);
        expect(plan.args[i - 1]).toBe("--ro-bind");
        expect(plan.args[i + 1]).toBe("/workspace/.ssh/id_ed25519");
        const envIdx = plan.args.indexOf("GIT_SSH_COMMAND");
        expect(envIdx).toBeGreaterThan(-1);
        expect(plan.args[envIdx + 1]).toContain("/workspace/.ssh/id_ed25519");
      } else {
        expect(plan.env.GIT_SSH_COMMAND).toContain(key);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(dirname(key), { recursive: true, force: true });
    }
  });

  it("adds SSH commit-signing git config only when a signing key is given", () => {
    const dir = mkdtempSync(join(tmpdir(), "otter-ws-"));
    const key = join(mkdtempSync(join(tmpdir(), "otter-key-")), "id_ed25519");
    writeFileSync(key, "PRIVATE", { mode: 0o600 });
    try {
      const withSign = buildSandboxPlan(dir, new Map(), ["/bin/sh", "-c", "true"], {
        gitSsh: { keyPath: key, signingKeyPath: `${key}.pub` },
      });
      const without = buildSandboxPlan(dir, new Map(), ["/bin/sh", "-c", "true"], {
        gitSsh: { keyPath: key },
      });
      if ("error" in withSign || "error" in without) return;
      const flat = (p: typeof withSign) => ("plan" in p ? p.plan.args.join(" ") + JSON.stringify(p.plan.env) : "");
      expect(flat(withSign)).toContain("commit.gpgsign");
      expect(flat(without)).not.toContain("commit.gpgsign");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(dirname(key), { recursive: true, force: true });
    }
  });
});
