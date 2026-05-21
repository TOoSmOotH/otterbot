import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "../test/fake-openai.js";
import { getConfig, type Config } from "../config.js";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { controlSchema } from "../db/control-db.js";
import { ProfileStore } from "../profiles/profile-store.js";
import { Orchestrator, GLOBAL_SETTINGS_KEY } from "./orchestrator.js";

/**
 * Boot the orchestrator on a data dir pre-seeded with the legacy (pre-registry)
 * ModelRef-based shapes and assert the one-time migration rewrites profiles to
 * configured-model ids and synthesizes a model registry from the old defaults.
 */
describe("legacy model-ref migration", () => {
  let fake: FakeOpenAI;
  let orch: Orchestrator;
  let control: ControlDb;
  let dataDir: string;

  beforeAll(async () => {
    fake = await startFakeOpenAI();
    process.env.LMSTUDIO_BASE_URL = fake.url;
    process.env.LMSTUDIO_API_KEY = "test-key";
    process.env.LMSTUDIO_MODEL = fake.model;

    dataDir = mkdtempSync(join(tmpdir(), "otter-migrate-"));
    const cfg: Config = {
      ...getConfig(),
      dataDir,
      assetsDir: join(dataDir, "assets"),
      port: 0,
      logLevel: "warn",
      model: fake.model,
      dbKey: null,
    };

    // Pre-seed a legacy COO profile.json storing ModelRef objects + allowedModels.
    const cooDir = join(dataDir, "profiles", "coo");
    mkdirSync(cooDir, { recursive: true });
    writeFileSync(
      join(cooDir, "profile.json"),
      JSON.stringify({
        id: "coo",
        displayName: "Otterbot COO",
        role: "coo",
        model: {
          chat: { provider: "lmstudio", account: "default", modelId: fake.model },
          embedding: { provider: "lmstudio", account: "default", modelId: fake.model },
        },
        allowedModels: [{ provider: "lmstudio", account: "*", modelId: "*" }],
        createdAt: new Date().toISOString(),
      }),
      "utf8"
    );
    writeFileSync(join(cooDir, "SOUL.md"), "persona", "utf8");

    control = openControlDb(join(dataDir, "control.db"));
    // Pre-seed legacy global settings (ModelRef defaults + context windows).
    control.db
      .insert(controlSchema.appSettings)
      .values({
        key: GLOBAL_SETTINGS_KEY,
        value: JSON.stringify({
          theme: "obsidian",
          defaultChatModel: { provider: "lmstudio", account: "default", modelId: fake.model },
          defaultEmbeddingModel: { provider: "lmstudio", account: "default", modelId: fake.model },
          modelContextWindows: [{ provider: "lmstudio", modelId: fake.model, contextWindow: 12345 }],
          providers: {},
        }),
      })
      .run();

    const profiles = new ProfileStore(join(dataDir, "profiles"));
    orch = new Orchestrator(profiles, control, cfg);
    await orch.boot();
  }, 30_000);

  afterAll(async () => {
    await orch.shutdown();
    try {
      control.close();
    } catch {
      // already closed
    }
    await fake.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("synthesizes a model registry from the legacy defaults", () => {
    const settings = orch.getGlobalSettings();
    expect(Array.isArray(settings.models)).toBe(true);
    expect(settings.defaultChatModelId).toBeTruthy();
    const chat = settings.models.find((m) => m.id === settings.defaultChatModelId);
    expect(chat?.provider).toBe("lmstudio");
    expect(chat?.modelId).toBe(fake.model);
    // The legacy context window is carried onto the chat model entry.
    expect(chat?.contextWindow).toBe(12345);
  });

  it("rewrites the profile's ModelRefs to configured-model ids", () => {
    const profile = orch.listProfiles().find((p) => p.id === "coo");
    expect(profile).toBeDefined();
    expect(typeof profile!.model.chat).toBe("string");
    expect(typeof profile!.model.embedding).toBe("string");
    // The referenced ids resolve to a real provider/model.
    const ref = orch.resolveModelRef(profile!.model.chat);
    expect(ref.provider).toBe("lmstudio");
    expect(ref.modelId).toBe(fake.model);
    // allowedModels is gone from the migrated profile.
    expect("allowedModels" in profile!).toBe(false);
  });
});
