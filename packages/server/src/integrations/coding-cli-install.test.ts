import { describe, it, expect } from "vitest";
import { CODING_TOOLS } from "./coding-cli.js";
import { CODING_CLI_SPECS, checkSharedCodingClis } from "./coding-cli-install.js";

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
