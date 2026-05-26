import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig turn limits", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.OTTERBOT_BROWSE_TIMEOUT_MS;
    delete process.env.OTTERBOT_AGENT_MAX_STEPS;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("defaults browse timeout to 60s and max steps to 8", () => {
    const cfg = loadConfig();
    expect(cfg.browseTimeoutMs).toBe(60_000);
    expect(cfg.agentMaxSteps).toBe(8);
  });

  it("reads overrides from env", () => {
    process.env.OTTERBOT_BROWSE_TIMEOUT_MS = "180000";
    process.env.OTTERBOT_AGENT_MAX_STEPS = "16";
    const cfg = loadConfig();
    expect(cfg.browseTimeoutMs).toBe(180_000);
    expect(cfg.agentMaxSteps).toBe(16);
  });
});
