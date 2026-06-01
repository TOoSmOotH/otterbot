import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { getConfig } from "./config.js";
import { openControlDb } from "./db/control-db.js";
import { ProfileStore } from "./profiles/profile-store.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { buildServer } from "./server.js";
import { attachSocketServer } from "./socket.js";
import { initOpenAiAuth } from "./auth/openai-auth-store.js";
import { createAuthStore } from "./auth/api-token.js";

async function main() {
  const cfg = getConfig();

  if (!cfg.dbKey) {
    console.warn(
      "[otterbot] OTTERBOT_DB_KEY is not set — databases will be UNENCRYPTED. " +
        "Set it in .env for an encrypted credential store."
    );
  }

  // Make sure dataDir exists before we read/write the auth file in it.
  mkdirSync(cfg.dataDir, { recursive: true });
  const auth = createAuthStore(cfg.dataDir);

  const mode = auth.mode();
  if (mode === "setup") {
    console.warn(
      `[otterbot] no password configured — entering setup mode. Open the web ` +
        `UI to create a password (it will be saved at ${auth.path()}).`
    );
  } else if (mode === "env") {
    console.warn(
      "[otterbot] API auth pinned by OTTERBOT_API_TOKEN — sessions are disabled."
    );
  } else {
    console.warn(`[otterbot] API auth enabled (password loaded from ${auth.path()})`);
  }
  // Make sure pending lastUsedAt updates land on disk during a clean shutdown.
  const flushAuth = () => auth.flush();
  process.once("SIGINT", flushAuth);
  process.once("SIGTERM", flushAuth);
  process.once("beforeExit", flushAuth);

  // Control plane + orchestrator: load (or first-run migrate) every agent.
  const control = openControlDb(resolve(cfg.dataDir, "control.db"), cfg.dbKey);
  const profiles = new ProfileStore(resolve(cfg.dataDir, "profiles"));
  const orch = new Orchestrator(profiles, control, cfg);
  initOpenAiAuth({
    getSetting: (k) => orch.getSetting(k),
    setSetting: (k, v) => orch.setSetting(k, v),
  });
  await orch.boot();

  const app = await buildServer(orch, cfg, { auth });
  app.log.info({ agents: orch.listSummaries().length }, "agents booted");

  await app.ready();
  attachSocketServer(app.server, orch, { auth });

  await app.listen({ port: cfg.port, host: cfg.host });
  app.log.info(`otterbot listening on http://${cfg.host}:${cfg.port}`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
