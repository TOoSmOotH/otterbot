import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { GlobalSecretsStore } from "../secrets/global-secrets-store.js";
import { CredentialStore } from "./credential-store.js";
import { ConnectionStore } from "./connection-store.js";
import { IntegrationStore } from "./integration-store.js";

describe("IntegrationStore facade", () => {
  let dir: string;
  let control: ControlDb;
  let integrations: IntegrationStore;
  let accounts: CredentialStore;
  let bindings: ConnectionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-integ-"));
    control = openControlDb(join(dir, "control.db"));
    accounts = new CredentialStore(control, new GlobalSecretsStore(control));
    bindings = new ConnectionStore(control);
    integrations = new IntegrationStore(accounts, bindings);
  });
  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports the bindings that use an account", () => {
    const acct = accounts.create({ type: "slack", label: "ws", secrets: { SLACK_BOT_TOKEN: "xoxb-1" } });
    const a = bindings.create({ type: "slack", label: "#eng", credentialId: acct.id });
    const b = bindings.create({ type: "slack", label: "#ops", credentialId: acct.id });
    bindings.create({ type: "slack", label: "#other", credentialId: null });
    expect(integrations.bindingsUsingAccount(acct.id).map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("refuses to delete an in-use account unless forced, then detaches bindings", () => {
    const acct = accounts.create({ type: "github", label: "gh", secrets: { GITHUB_TOKEN: "ghp" } });
    const bind = bindings.create({ type: "github", label: "gh-bind", credentialId: acct.id });

    const refused = integrations.deleteAccount(acct.id);
    expect(refused.ok).toBe(false);
    expect(accounts.get(acct.id)).not.toBeNull();

    const forced = integrations.deleteAccount(acct.id, { force: true });
    expect(forced.ok).toBe(true);
    expect(accounts.get(acct.id)).toBeNull();
    expect(bindings.get(bind.id)!.credentialId).toBeNull(); // detached, not deleted
  });

  it("resolves explicit assignments and all-agents bindings for an agent", () => {
    const assigned = bindings.create({ type: "slack", label: "#eng", credentialId: null });
    bindings.assign(assigned.id, "alice");
    const instanceWide = bindings.create({ type: "github", label: "shared-gh", credentialId: null, allAgents: true });
    const unrelated = bindings.create({ type: "discord", label: "#x", credentialId: null });
    bindings.assign(unrelated.id, "bob");

    const forAlice = integrations.bindingsForAgent("alice").map((b) => b.id).sort();
    expect(forAlice).toEqual([assigned.id, instanceWide.id].sort());
    // Bob gets the instance-wide one plus his own, but not Alice's.
    const forBob = integrations.bindingsForAgent("bob").map((b) => b.id).sort();
    expect(forBob).toEqual([instanceWide.id, unrelated.id].sort());
  });
});
