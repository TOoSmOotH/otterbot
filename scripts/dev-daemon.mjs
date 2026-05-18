#!/usr/bin/env node
/**
 * Launch a local otterbot daemon for manual testing.
 *
 * Builds the workspace, then drives the daemon CLI against an isolated state
 * directory (`.otterbot-dev/` in the repo) so it never touches your real
 * `~/.otterbot`. This exercises the same `otterbot start/stop/...` flow that
 * ships in the published package.
 *
 *   node scripts/dev-daemon.mjs [start|stop|restart|status|logs]   (default: start)
 *
 * Examples:
 *   node scripts/dev-daemon.mjs start          # build + start on port 3001
 *   PORT=4000 node scripts/dev-daemon.mjs start
 *   node scripts/dev-daemon.mjs logs -f
 *   node scripts/dev-daemon.mjs stop
 *
 * For hot-reload development (server + Vite HMR) use `pnpm dev` instead.
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] ?? "start";
const valid = ["start", "stop", "restart", "status", "logs"];
if (!valid.includes(command)) {
  console.error(`usage: node scripts/dev-daemon.mjs [${valid.join("|")}]`);
  process.exit(1);
}

const env = { ...process.env, OTTERBOT_HOME: join(repoRoot, ".otterbot-dev") };

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: repoRoot, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The daemon runs the compiled server, so build before (re)starting.
if (command === "start" || command === "restart") {
  console.log("[dev-daemon] building workspace…");
  run("pnpm", ["build"]);
}

const cliArgs = [join("packages", "cli", "dist", "cli.js"), command];
if (command === "start" || command === "restart") {
  cliArgs.push("--port", process.env.PORT ?? "3001");
} else {
  cliArgs.push(...process.argv.slice(3)); // pass through, e.g. `logs -f`
}
run("node", cliArgs);

if (command === "start" || command === "restart") {
  console.log("[dev-daemon] state dir: .otterbot-dev/ — `node scripts/dev-daemon.mjs stop` to stop");
}
