import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { ForgeService } from "./forge-service.js";

describe("ForgeService", () => {
  let dir: string;
  let control: ControlDb;
  let svc: ForgeService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-forge-"));
    control = openControlDb(join(dir, "control.db"));
    svc = new ForgeService(control, join(dir, "keys"));
  });
  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores an https account with the token redacted in the masked list", () => {
    const acc = svc.addAccount({ provider: "github", label: "gh", token: "secret" });
    expect(acc.gitTransport).toBe("https");
    const masked = svc.listAccountsMasked();
    expect(masked[0]).toMatchObject({ id: acc.id, provider: "github", hasToken: true, publicKey: null });
    expect(masked[0]).not.toHaveProperty("token");
  });

  it("generates a managed SSH key for an ssh account and exposes the public key", () => {
    const acc = svc.addAccount({
      provider: "github",
      label: "gh-ssh",
      token: "secret",
      gitTransport: "ssh",
      signCommits: true,
      committerName: "Otter Bot",
      committerEmail: "bot@example.com",
    });
    const pub = svc.publicKey(acc.id);
    expect(pub).toMatch(/^ssh-ed25519 /);
    expect(svc.listAccountsMasked()[0].publicKey).toBe(pub);

    const ctx = svc.gitContextFor(acc);
    expect(ctx.sshKeyPath).toContain(acc.id);
    expect(ctx.signingKeyPath).toBe(`${ctx.sshKeyPath}.pub`);
    expect(ctx.committer).toEqual({ name: "Otter Bot", email: "bot@example.com" });
    expect(ctx.knownHostsPath).toBeTruthy();
  });

  it("does not sign or set an ssh key for https accounts", () => {
    const acc = svc.addAccount({
      provider: "gitea",
      label: "gt",
      baseUrl: "https://gitea.lan",
      token: "secret",
      signCommits: true, // ignored without ssh transport
    });
    expect(acc.signCommits).toBe(false);
    const ctx = svc.gitContextFor(acc);
    expect(ctx.sshKeyPath).toBeUndefined();
    expect(ctx.signingKeyPath).toBeUndefined();
  });
});
