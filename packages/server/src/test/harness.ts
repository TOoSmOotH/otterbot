import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import { getConfig, type Config } from "../config.js";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { ProfileStore } from "../profiles/profile-store.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";

/**
 * A booted otterbot stack wired to a fake OpenAI-compatible model server, in a
 * throwaway temp data directory. Call `createTestStack()` once per test file
 * (the config singleton caches the first model URL it sees).
 */
export interface TestStack {
  orch: Orchestrator;
  fake: FakeOpenAI;
  cfg: Config;
  control: ControlDb;
  profiles: ProfileStore;
  dataDir: string;
  cleanup(): Promise<void>;
}

export async function createTestStack(): Promise<TestStack> {
  const fake = await startFakeOpenAI();
  // Point every `lmstudio`-provider agent at the fake server. Must happen
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
  };

  const control = openControlDb(join(dataDir, "control.db"));
  const profiles = new ProfileStore(join(dataDir, "profiles"));
  const orch = new Orchestrator(profiles, control, cfg);
  await orch.boot();

  return {
    orch,
    fake,
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
