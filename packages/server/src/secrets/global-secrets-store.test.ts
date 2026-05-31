import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { GlobalSecretsStore } from "./global-secrets-store.js";

describe("GlobalSecretsStore", () => {
  let dir: string;
  let control: ControlDb;
  let store: GlobalSecretsStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-gsec-"));
    control = openControlDb(join(dir, "control.db"));
    store = new GlobalSecretsStore(control);
  });

  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("upserts and retrieves a global secret with its scope", () => {
    store.upsert("PROXMOX_TOKEN_SECRET", "uuid-123", "direct");
    expect(store.get().get("PROXMOX_TOKEN_SECRET")).toBe("uuid-123");
    expect(store.getScoped().get("PROXMOX_TOKEN_SECRET")).toEqual({
      value: "uuid-123",
      scope: "direct",
    });
  });

  it("defaults a new key's scope to broad", () => {
    store.upsert("FOO", "bar");
    expect(store.getScoped().get("FOO")?.scope).toBe("broad");
  });

  it("upsert preserves the existing scope when none is given", () => {
    store.upsert("FOO", "v1", "direct");
    store.upsert("FOO", "v2");
    const entry = store.getScoped().get("FOO");
    expect(entry).toEqual({ value: "v2", scope: "direct" });
  });

  it("setScope changes scope without touching the value", () => {
    store.upsert("FOO", "v", "broad");
    expect(store.setScope("FOO", "cap:proxmox")).toBe(true);
    expect(store.getScoped().get("FOO")).toEqual({ value: "v", scope: "cap:proxmox" });
    expect(store.setScope("MISSING", "direct")).toBe(false);
  });

  it("listScopes returns keys + scopes but no values", () => {
    store.upsert("A", "1", "direct");
    store.upsert("B", "2", "broad");
    const scopes = store.listScopes().sort((x, y) => x.key.localeCompare(y.key));
    expect(scopes).toEqual([
      { key: "A", scope: "direct" },
      { key: "B", scope: "broad" },
    ]);
  });

  it("deleteOne removes a single key", () => {
    store.upsert("A", "1");
    store.upsert("B", "2");
    store.deleteOne("A");
    expect(store.get().has("A")).toBe(false);
    expect(store.get().get("B")).toBe("2");
  });
});
