import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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

  it("reads and removes a legacy .env for credential migration", () => {
    store.create(normalizeProfile({ id: "a", displayName: "A" }));
    writeFileSync(store.pathsFor("a").envFile, "GITHUB_TOKEN=ghp_legacy\n");
    const legacy = store.readLegacyEnv("a");
    expect(legacy?.get("GITHUB_TOKEN")).toBe("ghp_legacy");
    store.removeLegacyEnv("a");
    expect(store.readLegacyEnv("a")).toBeNull();
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
    expect(p.model.chat).toBe("default-chat");
    expect(p.model.embedding).toBe("default-embedding");
    expect(p.canSpawnSubagents).toBe(true);
  });
});
