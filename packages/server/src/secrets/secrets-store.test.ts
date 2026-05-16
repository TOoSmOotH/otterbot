import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { SecretsStore } from "./secrets-store.js";

describe("SecretsStore", () => {
  let dir: string;
  let control: ControlDb;
  let store: SecretsStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-sec-"));
    control = openControlDb(join(dir, "control.db"));
    store = new SecretsStore(control);
  });

  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores and retrieves an agent's credentials", () => {
    store.set("coo", { ANTHROPIC_API_KEY: "sk-1", GITHUB_TOKEN: "gh-1" });
    const got = store.get("coo");
    expect(got.get("ANTHROPIC_API_KEY")).toBe("sk-1");
    expect(got.get("GITHUB_TOKEN")).toBe("gh-1");
  });

  it("keeps each agent's credentials isolated", () => {
    store.set("a", { KEY: "a-value" });
    store.set("b", { KEY: "b-value" });
    expect(store.get("a").get("KEY")).toBe("a-value");
    expect(store.get("b").get("KEY")).toBe("b-value");
  });

  it("set() replaces all of an agent's credentials", () => {
    store.set("a", { OLD_KEY: "1" });
    store.set("a", { NEW_KEY: "2" });
    const got = store.get("a");
    expect(got.has("OLD_KEY")).toBe(false);
    expect(got.get("NEW_KEY")).toBe("2");
  });

  it("delete() removes an agent's credentials", () => {
    store.set("a", { KEY: "v" });
    expect(store.hasAny("a")).toBe(true);
    store.delete("a");
    expect(store.get("a").size).toBe(0);
    expect(store.hasAny("a")).toBe(false);
  });

  it("accepts a Map as well as a record", () => {
    store.set("a", new Map([["KEY", "v"]]));
    expect(store.get("a").get("KEY")).toBe("v");
  });
});
