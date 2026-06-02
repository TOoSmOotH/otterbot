import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ssh2 from "ssh2";
import { openControlDb, controlSchema, type ControlDb } from "../db/control-db.js";
import { SshKeyStore } from "./ssh-key-store.js";

const { utils } = ssh2;

describe("SshKeyStore", () => {
  let dir: string;
  let control: ControlDb;
  let store: SshKeyStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-sshkey-"));
    control = openControlDb(join(dir, "control.db"));
    store = new SshKeyStore(control, join(dir, "ssh-keys"));
  });
  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates an ed25519 key with a valid public line and SHA256 fingerprint", () => {
    const key = store.generate("my-key");
    expect(key.label).toBe("my-key");
    expect(key.publicKey).toMatch(/^ssh-ed25519 /);
    expect(key.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
    expect(key.fingerprint).not.toContain("="); // padding stripped
    // The masked record never carries the private key.
    expect(key).not.toHaveProperty("privateKey");
  });

  it("imports a private key and derives the same public line + fingerprint as generate", () => {
    // Round-trip: generate a key, read its stored private key, re-import it.
    const generated = store.generate("orig");
    const priv = control.db
      .select()
      .from(controlSchema.sshKeys)
      .all()
      .find((r) => r.id === generated.id)!.privateKey;

    const imported = store.import("copy", priv);
    expect(imported.publicKey).toBe(generated.publicKey);
    expect(imported.fingerprint).toBe(generated.fingerprint);

    // Fingerprint matches ssh2's own parse of the key.
    const parsed = utils.parseKey(priv);
    if (parsed instanceof Error) throw parsed;
    const line = `${parsed.type} ${parsed.getPublicSSH().toString("base64")}`;
    expect(imported.publicKey.startsWith(line)).toBe(true);
  });

  it("rejects an invalid private key", () => {
    expect(() => store.import("bad", "not a key")).toThrow();
  });

  it("never exposes the private key via list()", () => {
    store.generate("a");
    store.generate("b");
    const all = store.list();
    expect(all).toHaveLength(2);
    for (const k of all) expect(k).not.toHaveProperty("privateKey");
  });

  it("materializes a 0600 private file and a 0644 public file", () => {
    const key = store.generate("mat");
    const { privateKeyPath, publicKeyPath } = store.materialize(key.id);
    expect(readFileSync(privateKeyPath, "utf8")).toContain("PRIVATE KEY");
    expect(readFileSync(publicKeyPath, "utf8").trim()).toBe(key.publicKey);
    expect(statSync(privateKeyPath).mode & 0o777).toBe(0o600);
    expect(statSync(publicKeyPath).mode & 0o777).toBe(0o644);
  });

  it("refuses to delete a key referenced by a forge account unless forced", () => {
    const key = store.generate("linked");
    control.db
      .insert(controlSchema.forgeAccounts)
      .values({
        id: "acc1",
        provider: "github",
        label: "gh",
        baseUrl: "https://api.github.com",
        token: "t",
        sshKeyId: key.id,
        createdAt: new Date().toISOString(),
      })
      .run();

    const blocked = store.delete(key.id);
    expect(blocked.deleted).toBe(false);
    expect(blocked.referencedBy).toBe(1);
    expect(store.get(key.id)).not.toBeNull();

    const forced = store.delete(key.id, true);
    expect(forced.deleted).toBe(true);
    expect(store.get(key.id)).toBeNull();
  });
});
