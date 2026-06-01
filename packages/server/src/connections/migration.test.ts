import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "../test/fake-openai.js";
import { getConfig, type Config } from "../config.js";
import { openControlDb } from "../db/control-db.js";
import { ProfileStore, normalizeProfile } from "../profiles/profile-store.js";
import { SecretsStore } from "../secrets/secrets-store.js";
import { GlobalSecretsStore } from "../secrets/global-secrets-store.js";
import { CredentialStore } from "./credential-store.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { initOpenAiAuth } from "../auth/openai-auth-store.js";

/**
 * Boots a real Orchestrator over a profile that still carries inline Slack
 * config + tokens, and asserts the one-time migration folds it into a named
 * Credential + Connection + assignment — and is a no-op on a second boot.
 */
describe("inline → connections migration", () => {
  let fake: FakeOpenAI;
  let dataDir: string;

  afterEach(async () => {
    await fake?.close();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it("migrates inline chat config into a connection and is idempotent", async () => {
    fake = await startFakeOpenAI();
    process.env.LMSTUDIO_BASE_URL = fake.url;
    process.env.LMSTUDIO_API_KEY = "test-key";
    process.env.LMSTUDIO_MODEL = fake.model;

    dataDir = mkdtempSync(join(tmpdir(), "otter-mig-"));
    const cfg: Config = {
      ...getConfig(),
      dataDir,
      assetsDir: join(dataDir, "assets"),
      port: 0,
      logLevel: "warn",
      model: fake.model,
      dbKey: null,
    };

    // Seed: an agent with inline Slack config + tokens in agent_secrets.
    {
      const control = openControlDb(join(dataDir, "control.db"));
      const profiles = new ProfileStore(join(dataDir, "profiles"));
      profiles.create(
        normalizeProfile({
          id: "alice",
          displayName: "Alice",
          slack: { enabled: true, channelId: "C123", publicBot: false, allowedUserIds: ["U1"], mentionOnly: true },
        })
      );
      new SecretsStore(control).set("alice", { SLACK_BOT_TOKEN: "xoxb-real", SLACK_APP_TOKEN: "xapp-real" });
      control.close();
    }

    // First boot — migration runs.
    const control = openControlDb(join(dataDir, "control.db"));
    const profiles = new ProfileStore(join(dataDir, "profiles"));
    const orch = new Orchestrator(profiles, control, cfg);
    initOpenAiAuth({ getSetting: (k) => orch.getSetting(k), setSetting: (k, v) => orch.setSetting(k, v) });
    await orch.boot();

    const conns = orch.listConnections();
    const slack = conns.find((c) => c.type === "slack");
    expect(slack, "a slack connection was created").toBeTruthy();
    expect(slack!.assignedAgentIds).toEqual(["alice"]);
    expect(slack!.config.channelId).toBe("C123");
    expect(slack!.config.mentionOnly).toBe(true);

    // The credential exists and actually holds the moved tokens.
    expect(slack!.credentialId).toBeTruthy();
    const credStore = new CredentialStore(control, new GlobalSecretsStore(control));
    const secrets = credStore.secretsFor(slack!.credentialId!);
    expect(secrets.get("SLACK_BOT_TOKEN")).toBe("xoxb-real");
    expect(secrets.get("SLACK_APP_TOKEN")).toBe("xapp-real");

    // The tokens were removed from agent_secrets and the inline field cleared.
    expect(new SecretsStore(control).get("alice").has("SLACK_BOT_TOKEN")).toBe(false);
    expect(profiles.load("alice").slack).toBeNull();
    expect(orch.getSetting("connections_migrated")).toBe("true");

    const countAfterFirst = orch.listConnections().length;
    await orch.shutdown();
    control.close();

    // Second boot — guarded, no duplicate connections.
    const control2 = openControlDb(join(dataDir, "control.db"));
    const profiles2 = new ProfileStore(join(dataDir, "profiles"));
    const orch2 = new Orchestrator(profiles2, control2, cfg);
    await orch2.boot();
    expect(orch2.listConnections().length).toBe(countAfterFirst);
    await orch2.shutdown();
    control2.close();
  }, 30_000);
});
