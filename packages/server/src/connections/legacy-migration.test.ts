import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { GlobalSecretsStore } from "../secrets/global-secrets-store.js";
import { CredentialStore } from "./credential-store.js";
import { ConnectionStore } from "./connection-store.js";
import { IntegrationStore } from "./integration-store.js";
import { migrateLegacyCapabilities } from "./legacy-migration.js";

describe("legacy capability migration", () => {
  let dir: string;
  let control: ControlDb;
  let globalSecrets: GlobalSecretsStore;
  let integrations: IntegrationStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-legacy-"));
    control = openControlDb(join(dir, "control.db"));
    globalSecrets = new GlobalSecretsStore(control);
    const accounts = new CredentialStore(control, globalSecrets);
    const bindings = new ConnectionStore(control);
    integrations = new IntegrationStore(accounts, bindings);
  });
  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("folds bare Proxmox keys into an account + allAgents binding and removes the duplicates", () => {
    globalSecrets.upsert("PROXMOX_HOST", "pve.lan", "cap:proxmox");
    globalSecrets.upsert("PROXMOX_TOKEN_SECRET", "s3cret", "direct");

    migrateLegacyCapabilities(integrations, globalSecrets);

    const acct = integrations.listAccounts().find((a) => a.type === "proxmox");
    expect(acct).toBeTruthy();
    expect(integrations.accounts.secretsFor(acct!.id).get("PROXMOX_HOST")).toBe("pve.lan");
    expect(integrations.accounts.secretsFor(acct!.id).get("PROXMOX_TOKEN_SECRET")).toBe("s3cret");

    const binding = integrations.bindingsUsingAccount(acct!.id).find((b) => b.type === "proxmox");
    expect(binding?.allAgents).toBe(true);

    // The bare keys are gone — resolved from exactly one place now.
    expect(globalSecrets.get().has("PROXMOX_HOST")).toBe(false);
    expect(globalSecrets.instanceScoped().has("PROXMOX_HOST")).toBe(false);
  });

  it("is idempotent — a second run with no bare keys is a no-op", () => {
    globalSecrets.upsert("SSH_HOSTS", JSON.stringify([{ name: "box", host: "1.2.3.4" }]), "cap:ssh");
    migrateLegacyCapabilities(integrations, globalSecrets);
    const before = integrations.listAccounts().length;
    migrateLegacyCapabilities(integrations, globalSecrets);
    expect(integrations.listAccounts().length).toBe(before);
    expect(integrations.bindings.list().filter((b) => b.type === "ssh").length).toBe(1);
  });

  it("instanceScoped excludes cred:<id>:… account rows", () => {
    globalSecrets.upsert("MY_TOKEN", "abc", "broad");
    globalSecrets.upsert("cred:foo:SECRET", "xyz", "broad");
    const bare = globalSecrets.instanceScoped();
    expect(bare.has("MY_TOKEN")).toBe(true);
    expect(bare.has("cred:foo:SECRET")).toBe(false);
  });
});
