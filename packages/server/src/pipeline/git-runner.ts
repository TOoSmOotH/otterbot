import { spawnSync } from "node:child_process";

export interface GitResult {
  ok: boolean;
  output: string;
}

/** Runs git in a repo dir and reports success + combined stdout/stderr. */
export type GitRunner = (repoPath: string, args: string[]) => GitResult;

/** Default runner: shells out to the real `git` binary (mirrors ProjectStore.git). */
export const realGit: GitRunner = (repoPath, args) => {
  const r = spawnSync("git", ["-C", repoPath, ...args], { encoding: "utf8", timeout: 120_000 });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (r.error) return { ok: false, output: r.error.message };
  return { ok: r.status === 0, output };
};
