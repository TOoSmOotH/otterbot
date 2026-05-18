#!/usr/bin/env node
/** `otterbot` — manage the server daemon and chat with your agents. */
import meow from "meow";
import { render } from "ink";
import { App } from "./ui/App.js";
import { openWeb } from "./lifecycle/web.js";
import { ensureDaemon, showLogs, start, status, stop } from "./lifecycle/daemon.js";
import type { CliOptions, Command } from "./types.js";

const cli = meow(
  `
  Usage
    $ otterbot <command> [options]

  Commands
    start            Start the otterbot server daemon in the background
    stop             Stop the daemon
    restart          Restart the daemon
    status           Show whether the daemon is running
    logs             Print the daemon log (use -f to follow)
    chat             Open the interactive terminal chat (default)
    web              Open the web UI in a browser

  Options
    --agent <id>     Agent to chat with             (default coo)
    --port <n>       Port the daemon listens on     (default 3001)
    --host <h>       Host the daemon binds to       (default 0.0.0.0)
    --server <url>   Talk to an existing server     (env OTTER_SERVER)
    --no-spawn       chat: never auto-start the daemon
    -f, --follow     logs: keep streaming new output

  Examples
    $ otterbot start
    $ otterbot status
    $ otterbot chat --agent coo
    $ otterbot logs -f
`,
  {
    importMeta: import.meta,
    flags: {
      agent: { type: "string", default: "coo" },
      port: { type: "number" },
      host: { type: "string" },
      server: { type: "string" },
      spawn: { type: "boolean", default: true }, // negated via --no-spawn
      follow: { type: "boolean", shortFlag: "f", default: false },
    },
  }
);

const COMMANDS: readonly Command[] = [
  "start",
  "stop",
  "restart",
  "status",
  "logs",
  "chat",
  "web",
];

function parseCommand(input: string | undefined): Command {
  if (!input) return "chat";
  if ((COMMANDS as readonly string[]).includes(input)) return input as Command;
  console.error(`Unknown command "${input}". Run \`otterbot --help\` for usage.`);
  process.exit(1);
}

/** Derive a port from a server URL, falling back to `fallback`. */
function portFromUrl(url: string, fallback: number): number {
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === "https:" ? 443 : fallback;
  } catch {
    return fallback;
  }
}

const command = parseCommand(cli.input[0]);
const explicitServer = cli.flags.server || process.env.OTTER_SERVER || null;
const host = cli.flags.host ?? "0.0.0.0";
const port = cli.flags.port ?? (explicitServer ? portFromUrl(explicitServer, 3001) : 3001);
const serverUrl = explicitServer ?? `http://localhost:${port}`;

const options: CliOptions = {
  command,
  serverUrl,
  host,
  port,
  agentId: cli.flags.agent,
  noSpawn: !cli.flags.spawn,
  follow: cli.flags.follow,
};

/** Render the interactive Ink chat. Keeps the process alive until it exits. */
function runChat(): void {
  if (!process.stdin.isTTY) {
    console.error("otterbot chat needs an interactive terminal (stdin is not a TTY).");
    process.exit(1);
  }
  const app = render(<App options={options} />);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => app.unmount());
  }
  void app.waitUntilExit().then(() => process.exit(0));
}

async function main(): Promise<void> {
  switch (command) {
    case "start": {
      const result = await start({ port, host });
      console.log(
        result.alreadyRunning
          ? `otterbot is already running at ${result.url}`
          : `otterbot started at ${result.url}${result.devMode ? " (dev mode)" : ""}`
      );
      return;
    }
    case "stop": {
      console.log((await stop()).message);
      return;
    }
    case "restart": {
      await stop();
      const result = await start({ port, host });
      console.log(`otterbot restarted at ${result.url}`);
      return;
    }
    case "status": {
      const state = await status();
      if (state.running) {
        console.log("otterbot is running");
        console.log(`  url:     ${state.url}`);
        console.log(`  pid:     ${state.pid}`);
        if (state.startedAt) console.log(`  started: ${state.startedAt}`);
        if (typeof state.agentCount === "number") console.log(`  agents:  ${state.agentCount}`);
      } else {
        console.log("otterbot is not running.");
        process.exitCode = 1;
      }
      return;
    }
    case "logs": {
      await showLogs(options.follow);
      return;
    }
    case "web": {
      let url = serverUrl;
      if (!explicitServer && !options.noSpawn) {
        url = (await ensureDaemon({ port, host })).url;
      }
      openWeb(url);
      console.log(`Opening the otterbot web UI at ${url}`);
      return;
    }
    case "chat": {
      runChat();
      return;
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
