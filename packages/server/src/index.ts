import { resolve } from "node:path";
import { getConfig } from "./config.js";
import { openControlDb } from "./db/control-db.js";
import { ProfileStore } from "./profiles/profile-store.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { buildServer } from "./server.js";
import { attachSocketServer } from "./socket.js";
import { initOpenAiAuth } from "./auth/openai-auth-store.js";

async function main() {
  const cfg = getConfig();

  if (!cfg.dbKey) {
    console.warn(
      "[otterbot] OTTERBOT_DB_KEY is not set — databases will be UNENCRYPTED. " +
        "Set it in .env for an encrypted credential store."
    );
  }

  // Control plane + orchestrator: load (or first-run migrate) every agent.
  const control = openControlDb(resolve(cfg.dataDir, "control.db"), cfg.dbKey);
  const profiles = new ProfileStore(resolve(cfg.dataDir, "profiles"));
  const orch = new Orchestrator(profiles, control, cfg);
  initOpenAiAuth({
    getSetting: (k) => orch.getSetting(k),
    setSetting: (k, v) => orch.setSetting(k, v),
  });
  await orch.boot();

  const app = await buildServer(orch, cfg);
  app.log.info({ agents: orch.listSummaries().length }, "agents booted");

  await app.ready();
  attachSocketServer(app.server, orch);

  await app.listen({ port: cfg.port, host: cfg.host });
  app.log.info(`otterbot listening on http://${cfg.host}:${cfg.port}`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
