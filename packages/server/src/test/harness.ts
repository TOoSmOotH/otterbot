import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { getConfig, type Config } from "../config.js";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { ProfileStore } from "../profiles/profile-store.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { initOpenAiAuth } from "../auth/openai-auth-store.js";

/**
 * A booted otterbot stack for tests.
 *
 * By default it wires a fake OpenAI-compatible server (deterministic, offline).
 * For local end-to-end runs against a real model, set `OTTER_TEST_MODEL_URL`
 * and `OTTER_TEST_MODEL` — the harness then points the stack at that endpoint.
 * Tests assert on structure/non-emptiness, not exact content, so they pass
 * either way.
 *
 * Call `createTestStack()` once per test file (the config singleton caches the
 * first model URL it sees).
 */
export interface TestStack {
  orch: Orchestrator;
  fake: FakeOpenAI;
  /** True when running against a real model endpoint rather than the fake. */
  modelIsReal: boolean;
  cfg: Config;
  control: ControlDb;
  profiles: ProfileStore;
  dataDir: string;
  cleanup(): Promise<void>;
}

export async function createTestStack(): Promise<TestStack> {
  const realUrl = process.env.OTTER_TEST_MODEL_URL;
  const realModel = process.env.OTTER_TEST_MODEL;
  const modelIsReal = Boolean(realUrl && realModel);

  let fake: FakeOpenAI;
  if (modelIsReal) {
    // A stand-in handle pointing at the real endpoint; setNextReply is a no-op.
    fake = {
      url: realUrl!,
      model: realModel!,
      embeddingDim: 0,
      setNextReply: () => {},
      get chatRequests() {
        return 0;
      },
      close: async () => {},
    };
  } else {
    fake = await startFakeOpenAI();
  }

  // Point every `lmstudio`-provider agent at the chosen endpoint. Must happen
  // before the first getConfig() call (made during orch.boot()).
  process.env.LMSTUDIO_BASE_URL = fake.url;
  process.env.LMSTUDIO_API_KEY = "test-key";
  process.env.LMSTUDIO_MODEL = fake.model;

  const dataDir = mkdtempSync(join(tmpdir(), "otter-test-"));
  const cfg: Config = {
    ...getConfig(),
    dataDir,
    assetsDir: join(dataDir, "assets"),
    port: 0,
    logLevel: "warn",
    model: fake.model,
    dbKey: null,
  };

  const control = openControlDb(join(dataDir, "control.db"));
  const profiles = new ProfileStore(join(dataDir, "profiles"));
  const orch = new Orchestrator(profiles, control, cfg);
  initOpenAiAuth({
    getSetting: (k) => orch.getSetting(k),
    setSetting: (k, v) => orch.setSetting(k, v),
  });
  await orch.boot();

  return {
    orch,
    fake,
    modelIsReal,
    cfg,
    control,
    profiles,
    dataDir,
    cleanup: async () => {
      await orch.shutdown();
      try {
        control.close();
      } catch {
        // already closed
      }
      await fake.close();
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    },
  };
}
