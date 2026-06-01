import { describe, it, expect } from "vitest";
import { CODING_TOOLS } from "./coding-cli.js";
import { CODING_CLI_SPECS, buildProbeScript, parseProbeOutput } from "./coding-cli-install.js";

describe("CODING_CLI_SPECS", () => {
  it("covers every coding tool with an npm install command and a login command", () => {
    for (const tool of CODING_TOOLS) {
      const spec = CODING_CLI_SPECS[tool];
      expect(spec).toBeDefined();
      // Pinned to @latest so install always pulls the newest release.
      expect(spec.installCmd).toMatch(/^npm i -g .+@latest$/);
      expect(spec.bin).toBe(tool);
      expect(spec.loginCmd.length).toBeGreaterThan(0);
      expect(spec.authProbe).toMatch(/\$HOME/);
    }
  });
});

describe("buildProbeScript", () => {
  it("probes each tool's binary, version, and auth file", () => {
    const script = buildProbeScript();
    for (const tool of CODING_TOOLS) {
      const spec = CODING_CLI_SPECS[tool];
      expect(script).toContain(`command -v ${spec.bin}`);
      expect(script).toContain(spec.authProbe);
      expect(script).toContain(`'${tool}'`);
    }
  });
});

describe("parseProbeOutput", () => {
  it("parses installed + version + loggedIn from tab-delimited lines", () => {
    const out = [
      "claude\t1\t1.2.3 (Claude Code)\t1",
      "codex\t1\t0.1.0\t0",
      "gemini\t0\t\t0",
      "opencode\t0\t\t0",
    ].join("\n");
    const status = parseProbeOutput(out);
    expect(status.claude).toEqual({ installed: true, version: "1.2.3 (Claude Code)", loggedIn: true });
    expect(status.codex).toEqual({ installed: true, version: "0.1.0", loggedIn: false });
    expect(status.gemini).toEqual({ installed: false, loggedIn: false });
    expect(status.opencode).toEqual({ installed: false, loggedIn: false });
  });

  it("defaults every tool to not-installed when output is empty or garbled", () => {
    const status = parseProbeOutput("nonsense without tabs");
    for (const tool of CODING_TOOLS) {
      expect(status[tool]).toEqual({ installed: false, loggedIn: false });
    }
  });

  it("omits version when not installed even if a stray value is present", () => {
    const status = parseProbeOutput("claude\t0\tshould-be-ignored\t0");
    expect(status.claude).toEqual({ installed: false, loggedIn: false });
  });
});
