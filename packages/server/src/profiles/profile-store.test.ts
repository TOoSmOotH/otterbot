import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore, normalizeProfile } from "./profile-store.js";

describe("ProfileStore", () => {
  let root: string;
  let store: ProfileStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "otter-prof-"));
    store = new ProfileStore(join(root, "profiles"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates a default COO profile on first run", () => {
    const coo = store.ensureCooProfile({ chatModelId: "local-model" });
    expect(coo.id).toBe("coo");
    expect(coo.role).toBe("coo");
    const paths = store.pathsFor("coo");
    expect(existsSync(paths.profileJson)).toBe(true);
    expect(existsSync(paths.soulMd)).toBe(true);
  });

  it("round-trips a profile, resolving persona from SOUL.md", () => {
    const created = store.create(
      normalizeProfile({ id: "research", displayName: "Research", persona: "I research things." })
    );
    expect(created.id).toBe("research");
    const loaded = store.load("research");
    expect(loaded.displayName).toBe("Research");
    expect(loaded.persona).toBe("I research things.");
    // persona lives in SOUL.md, not profile.json
    const json = JSON.parse(readFileSync(store.pathsFor("research").profileJson, "utf8"));
    expect(json.persona).toBeUndefined();
  });

  it("lists all profiles", () => {
    store.ensureCooProfile({ chatModelId: "m" });
    store.create(normalizeProfile({ id: "a", displayName: "A" }));
    store.create(normalizeProfile({ id: "b", displayName: "B" }));
    expect(store.list().map((p) => p.id).sort()).toEqual(["a", "b", "coo"]);
  });

  it("reads and writes per-agent secrets without touching process.env", () => {
    store.create(normalizeProfile({ id: "a", displayName: "A" }));
    store.writeSecrets("a", new Map([["ANTHROPIC_API_KEY", "sk-test-123"]]));
    const secrets = store.readSecrets("a");
    expect(secrets.get("ANTHROPIC_API_KEY")).toBe("sk-test-123");
    expect(process.env.ANTHROPIC_API_KEY).not.toBe("sk-test-123");
  });

  it("deletes a profile directory", () => {
    store.create(normalizeProfile({ id: "doomed", displayName: "Doomed" }));
    expect(store.exists("doomed")).toBe(true);
    store.delete("doomed");
    expect(store.exists("doomed")).toBe(false);
  });

  it("normalizeProfile fills sane defaults", () => {
    const p = normalizeProfile({ id: "x" });
    expect(p.role).toBe("agent");
    expect(p.transport).toBe("local");
    expect(p.allowedModels.length).toBeGreaterThan(0);
    expect(p.canSpawnSubagents).toBe(true);
  });
});
