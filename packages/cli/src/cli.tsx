#!/usr/bin/env node
/** `otter` — terminal chat client for Otterbot. */
import meow from "meow";
import { render } from "ink";
import { App } from "./ui/App.js";
import { openWeb } from "./lifecycle/web.js";
import type { ServerHandle } from "./lifecycle/server-process.js";
import type { CliOptions } from "./types.js";

const cli = meow(
  `
  Usage
    $ otter [options]

  Options
    --server <url>   Server base URL          (default http://localhost:3001, env OTTER_SERVER)
    --agent <id>     Agent to chat with       (default coo)
    --port <n>       Port to boot a server on (default: derived from --server)
    --detach         Leave a CLI-started server running on exit
    --web            Open the web UI in a browser and exit
    --no-spawn       Never start a server; fail if none is running

  Examples
    $ otter
    $ otter --agent coo --server http://localhost:3001
    $ otter --web
`,
  {
    importMeta: import.meta,
    flags: {
      server: { type: "string" },
      agent: { type: "string", default: "coo" },
      port: { type: "number" },
      detach: { type: "boolean", default: false },
      web: { type: "boolean", default: false },
      spawn: { type: "boolean", default: true }, // negated via --no-spawn
    },
  }
);

const serverUrl = cli.flags.server || process.env.OTTER_SERVER || "http://localhost:3001";

/** Derive a port from the server URL, falling back to 3001. */
function portFromUrl(url: string): number {
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === "https:" ? 443 : 3001;
  } catch {
    return 3001;
  }
}

const options: CliOptions = {
  serverUrl,
  agentId: cli.flags.agent,
  port: cli.flags.port ?? portFromUrl(serverUrl),
  detach: cli.flags.detach,
  noSpawn: !cli.flags.spawn,
};

// --web: just open the browser and exit.
if (cli.flags.web) {
  openWeb(serverUrl);
  console.log(`Opening the Otterbot web UI at ${serverUrl}`);
  process.exit(0);
}

// Ink needs an interactive terminal.
if (!process.stdin.isTTY) {
  console.error("otter needs an interactive terminal (stdin is not a TTY).");
  process.exit(1);
}

// Mutable holder — a CLI-started server is reported here by <App>.
const lifecycle: { server: ServerHandle | null; shuttingDown: boolean } = {
  server: null,
  shuttingDown: false,
};

/** Kill a CLI-started server unless --detach was passed. Idempotent. */
function shutdown() {
  if (lifecycle.shuttingDown) return;
  lifecycle.shuttingDown = true;
  if (lifecycle.server && !options.detach) lifecycle.server.kill();
}

const app = render(
  <App
    options={options}
    onServerHandle={(handle) => {
      lifecycle.server = handle;
    }}
  />
);

// On a signal, unmount Ink first (restores the terminal and runs the chat
// hook's cleanup) — this resolves waitUntilExit so the run() finally block runs.
process.on("exit", shutdown);
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => app.unmount());
}

// Wrapped in a function so a pending await never trips Node's
// "unsettled top-level await" warning during signal-driven shutdown.
async function run(): Promise<void> {
  try {
    await app.waitUntilExit();
  } finally {
    if (lifecycle.server && options.detach) {
      console.log(
        `Server left running at ${serverUrl} (pid ${lifecycle.server.pid ?? "?"}).`
      );
    } else {
      shutdown();
    }
  }
  process.exit(0);
}

void run();
