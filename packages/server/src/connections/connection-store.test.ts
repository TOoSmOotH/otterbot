import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { GlobalSecretsStore } from "../secrets/global-secrets-store.js";
import { CredentialStore } from "./credential-store.js";
import { ConnectionStore } from "./connection-store.js";

describe("Credential + Connection stores", () => {
  let dir: string;
  let control: ControlDb;
  let creds: CredentialStore;
  let conns: ConnectionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-conn-"));
    control = openControlDb(join(dir, "control.db"));
    creds = new CredentialStore(control, new GlobalSecretsStore(control));
    conns = new ConnectionStore(control);
  });
  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores credential secrets out-of-band and never returns raw values", () => {
    const cred = creds.create({
      type: "matrix",
      label: "team matrix",
      secrets: { MATRIX_HOMESERVER_URL: "https://m.example", MATRIX_USER: "bot", MATRIX_PASSWORD: "hunter2" },
    });
    const masked = creds.get(cred.id)!;
    expect(masked.fieldsPresent.MATRIX_PASSWORD).toBe(true);
    expect(JSON.stringify(masked)).not.toContain("hunter2");
    // But the runtime accessor resolves the real value.
    expect(creds.secretsFor(cred.id).get("MATRIX_PASSWORD")).toBe("hunter2");
  });

  it("keeps an existing secret when an edit sends a blank value", () => {
    const cred = creds.create({ type: "github", label: "gh", secrets: { GITHUB_TOKEN: "ghp_real" } });
    creds.update(cred.id, { label: "renamed", secrets: { GITHUB_TOKEN: "" } });
    expect(creds.get(cred.id)!.label).toBe("renamed");
    expect(creds.secretsFor(cred.id).get("GITHUB_TOKEN")).toBe("ghp_real");
  });

  it("deletes a credential's namespaced secrets on delete", () => {
    const cred = creds.create({ type: "github", label: "gh", secrets: { GITHUB_TOKEN: "x" } });
    creds.delete(cred.id);
    expect(creds.get(cred.id)).toBeNull();
    expect(creds.secretsFor(cred.id).size).toBe(0);
  });

  it("resolves an agent's connections and reports assignees", () => {
    const c = conns.create({ type: "github", label: "gh", credentialId: null });
    conns.assign(c.id, "alice");
    conns.assign(c.id, "bob"); // non-chat: many agents allowed
    expect(conns.assigneesOf(c.id).sort()).toEqual(["alice", "bob"]);
    expect(conns.connectionsForAgent("alice").map((x) => x.id)).toEqual([c.id]);
  });

  it("separates chat from non-chat connections for an agent", () => {
    const chat = conns.create({ type: "slack", label: "s", credentialId: null });
    conns.create({ type: "github", label: "g", credentialId: null });
    conns.assign(chat.id, "alice");
    expect(conns.chatConnectionsForAgent("alice").map((c) => c.type)).toEqual(["slack"]);
  });
});
