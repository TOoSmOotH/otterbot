/** Open the Otterbot web UI in the user's default browser. */
import { spawn } from "node:child_process";

/** Platform-appropriate "open this URL" command. */
function opener(): { cmd: string; args: string[] } {
  switch (process.platform) {
    case "darwin":
      return { cmd: "open", args: [] };
    case "win32":
      // `start` is a cmd builtin; the empty "" is the window-title argument.
      return { cmd: "cmd", args: ["/c", "start", ""] };
    default:
      return { cmd: "xdg-open", args: [] };
  }
}

/** Launch the browser at `url`, detached so it outlives the CLI. */
export function openWeb(url: string): void {
  const { cmd, args } = opener();
  try {
    const child = spawn(cmd, [...args, url], { stdio: "ignore", detached: true });
    child.on("error", () => {
      /* no browser opener available — silently ignore */
    });
    child.unref();
  } catch {
    /* ignore — opening a browser is best-effort */
  }
}
