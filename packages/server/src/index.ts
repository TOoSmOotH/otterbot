import { resolve } from "node:path";
import { getConfig } from "./config.js";
import { openControlDb } from "./db/control-db.js";
import { ProfileStore } from "./profiles/profile-store.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { buildServer } from "./server.js";
import { attachSocketServer } from "./socket.js";

async function main() {
  const cfg = getConfig();

  // Control plane + orchestrator: load (or first-run migrate) every agent.
  const control = openControlDb(resolve(cfg.dataDir, "control.db"));
  const profiles = new ProfileStore(resolve(cfg.dataDir, "profiles"));
  const orch = new Orchestrator(profiles, control, cfg);
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
