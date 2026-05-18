/** Filesystem locations for the otterbot daemon: state dir + server resolution. */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The otterbot state directory — `~/.otterbot`, overridable with `OTTERBOT_HOME`. */
export function otterHome(): string {
  return process.env.OTTERBOT_HOME ?? join(homedir(), ".otterbot");
}

export const pidFilePath = (): string => join(otterHome(), "otterbot.pid");
export const logFilePath = (): string => join(otterHome(), "otterbot.log");
export const envFilePath = (): string => join(otterHome(), ".env");
export const dataDirPath = (): string => join(otterHome(), "data");

/** Directory of the compiled CLI package (this module sits in `<cli>/lifecycle`). */
function cliRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/** Version of the installed otterbot package, best-effort. */
export function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(cliRoot(), "../package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** How to launch the otterbot server, with the asset/web paths it needs. */
export interface ServerTarget {
  command: string;
  args: string[];
  cwd: string;
  /** Extra env: `ASSETS_DIR` / `WEB_DIST_DIR` resolved for this layout. */
  env: Record<string, string>;
  /** True when launched from source via pnpm (slower first boot). */
  devMode: boolean;
}

/**
 * Locate the otterbot server. Works both for the published package
 * (`<pkg>/server/index.js`, sibling of `<pkg>/cli`) and inside the repo
 * (`packages/server/dist/index.js`, or `pnpm dev` when not built).
 */
export function resolveServerTarget(): ServerTarget {
  const cli = cliRoot();

  // Published package layout: <pkg>/{cli,server,assets,web}
  const pkgRoot = resolve(cli, "..");
  const pkgServer = join(pkgRoot, "server", "index.js");
  if (existsSync(pkgServer)) {
    return {
      command: process.execPath,
      args: [pkgServer],
      cwd: pkgRoot,
      env: { ASSETS_DIR: join(pkgRoot, "assets"), WEB_DIST_DIR: join(pkgRoot, "web") },
      devMode: false,
    };
  }

  // In-repo: <repo>/packages/{cli,server,web}, <repo>/assets
  const repoRoot = resolve(cli, "..", "..", "..");
  const repoEnv = {
    ASSETS_DIR: join(repoRoot, "assets"),
    WEB_DIST_DIR: join(repoRoot, "packages", "web", "dist"),
  };
  const repoServer = join(repoRoot, "packages", "server", "dist", "index.js");
  if (existsSync(repoServer)) {
    return { command: process.execPath, args: [repoServer], cwd: repoRoot, env: repoEnv, devMode: false };
  }

  // In-repo, not built — run the server from source.
  if (existsSync(join(repoRoot, "pnpm-workspace.yaml"))) {
    return {
      command: "pnpm",
      args: ["--filter", "@otterbot/server", "dev"],
      cwd: repoRoot,
      env: repoEnv,
      devMode: true,
    };
  }

  throw new Error(
    "Could not locate the otterbot server. If running from the repo, run `pnpm build` first."
  );
}
