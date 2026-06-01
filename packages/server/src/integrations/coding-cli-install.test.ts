import { describe, it, expect } from "vitest";
import { CODING_TOOLS } from "./coding-cli.js";
import {
  CODING_CLI_SPECS,
  checkSharedCodingClis,
  isNewerVersion,
  sharedCodingStatus,
} from "./coding-cli-install.js";

describe("CODING_CLI_SPECS", () => {
  it("covers every coding tool with a package, login command, and auth file", () => {
    for (const tool of CODING_TOOLS) {
      const spec = CODING_CLI_SPECS[tool];
      expect(spec).toBeDefined();
      expect(spec.bin).toBe(tool);
      expect(spec.pkg.length).toBeGreaterThan(0);
      expect(spec.loginCmd.length).toBeGreaterThan(0);
      // Auth file lives under the tool's shared credential subdir.
      expect(spec.authFile.startsWith(`${tool}/`)).toBe(true);
    }
  });
});

describe("checkSharedCodingClis", () => {
  it("reports every tool as not-installed / not-logged-in when nothing is set up", () => {
    // No shared tools dir exists under the test data dir, so all probes are false.
    const status = checkSharedCodingClis();
    for (const tool of CODING_TOOLS) {
      expect(status[tool]).toEqual({ installed: false, loggedIn: false });
    }
  });
});

describe("isNewerVersion", () => {
  it("detects a newer published version, ignoring extra words in the installed string", () => {
    expect(isNewerVersion("1.2.5", "1.2.3")).toBe(true);
    expect(isNewerVersion("0.135.1", "codex-cli 0.135.0")).toBe(true);
    expect(isNewerVersion("2.1.160", "2.1.159 (Claude Code)")).toBe(true);
  });
  it("is false when equal or older", () => {
    expect(isNewerVersion("1.2.3", "1.2.3")).toBe(false);
    expect(isNewerVersion("1.2.3", "1.3.0")).toBe(false);
  });
  it("never nags when a version can't be parsed", () => {
    expect(isNewerVersion(undefined, "1.2.3")).toBe(false);
    expect(isNewerVersion("1.2.3", undefined)).toBe(false);
    expect(isNewerVersion("latest", "1.2.3")).toBe(false);
  });
});

describe("sharedCodingStatus", () => {
  it("merges cached latest versions in (no update flagged while not installed)", () => {
    const store = {
      getSetting: () =>
        JSON.stringify({ checkedAt: 0, latest: { claude: "9.9.9", codex: null, gemini: null, opencode: null } }),
      setSetting: () => {},
    };
    const status = sharedCodingStatus(store);
    expect(status.claude.latest).toBe("9.9.9");
    // Not installed in the test env, so no update is claimed.
    expect(status.claude.updateAvailable).toBe(false);
  });
});
