import { describe, it, expect } from "vitest";
import { ForgeMonitor, type ForgeMonitorDeps, type WatchableRun } from "./forge-monitor.js";
import type { Forge, ForgeIssue, ForgePullRequest, ForgeReview, CheckState } from "./forge.js";

/** A minimal fake Forge whose responses are scripted per test. */
function fakeForge(over: Partial<Forge>): Forge {
  return {
    provider: "github",
    account: {
      id: "a",
      provider: "github",
      label: "x",
      baseUrl: "",
      token: "t",
      username: "bot",
      gitTransport: "https",
      committerName: "",
      committerEmail: "",
      signCommits: false,
    },
    getRepo: async () => ({ owner: "o", name: "n", defaultBranch: "main", cloneUrl: "", sshUrl: null, htmlUrl: "" }),
    createRepo: async () => ({ owner: "o", name: "n", defaultBranch: "main", cloneUrl: "", sshUrl: null, htmlUrl: "" }),
    forkRepo: async () => ({ owner: "bot", name: "n", defaultBranch: "main", cloneUrl: "", sshUrl: null, htmlUrl: "" }),
    authedCloneUrl: () => "",
    openPullRequest: async () => ({ number: 1, htmlUrl: "", state: "open", merged: false, headBranch: "b", headSha: "s" }),
    getPullRequest: async () => ({ number: 1, htmlUrl: "", state: "open", merged: false, headBranch: "b", headSha: "s" }),
    listReviews: async () => [],
    checkState: async () => "none" as CheckState,
    listAssignedIssues: async () => [],
    commentIssue: async () => {},
    ...over,
  };
}

const issue = (number: number): ForgeIssue => ({
  number,
  title: `issue ${number}`,
  body: "body",
  author: "u",
  htmlUrl: "h",
});

function baseDeps(over: Partial<ForgeMonitorDeps>, forge: Forge): ForgeMonitorDeps {
  return {
    listMonitoredProjects: () => [{ id: "p1", forgeRepo: "o/n" }],
    forgeForProject: () => forge,
    hasRunForIssue: () => false,
    startRunFromIssue: () => "run1",
    watchableRuns: () => [],
    resumeRun: () => true,
    ...over,
  };
}

describe("ForgeMonitor.pollIssues", () => {
  it("starts a run + comments for a new assigned issue, once", async () => {
    const started: number[] = [];
    let commented = 0;
    const forge = fakeForge({
      listAssignedIssues: async () => [issue(5)],
      commentIssue: async () => {
        commented += 1;
      },
    });
    const handled = new Set<number>();
    const deps = baseDeps(
      {
        hasRunForIssue: (_p, n) => handled.has(n),
        startRunFromIssue: (_p, i) => {
          started.push(i.number);
          handled.add(i.number);
          return "run-x";
        },
      },
      forge
    );
    const mon = new ForgeMonitor(deps);
    await mon.pollOnce();
    await mon.pollOnce(); // second cycle: already handled
    expect(started).toEqual([5]);
    expect(commented).toBe(1);
  });
});

describe("ForgeMonitor.pollPullRequests", () => {
  const watch = (): WatchableRun[] => [{ id: "run1", prNumber: 9, status: "done" }];

  it("kicks back when changes are requested", async () => {
    const resumed: Array<{ id: string; feedback: string }> = [];
    const forge = fakeForge({
      listReviews: async (): Promise<ForgeReview[]> => [{ id: 1, state: "CHANGES_REQUESTED", author: "rev" }],
    });
    const mon = new ForgeMonitor(
      baseDeps({ watchableRuns: watch, resumeRun: (id, fb) => (resumed.push({ id, feedback: fb }), true) }, forge)
    );
    await mon.pollOnce();
    expect(resumed).toHaveLength(1);
    expect(resumed[0].feedback).toMatch(/requested changes/);
  });

  it("kicks back when CI fails", async () => {
    const resumed: string[] = [];
    const forge = fakeForge({ checkState: async () => "failure" as CheckState });
    const mon = new ForgeMonitor(
      baseDeps({ watchableRuns: watch, resumeRun: (id) => (resumed.push(id), true) }, forge)
    );
    await mon.pollOnce();
    expect(resumed).toEqual(["run1"]);
  });

  it("does nothing for a clean PR, and stops watching once merged", async () => {
    let prCalls = 0;
    const resumed: string[] = [];
    const forge = fakeForge({
      getPullRequest: async (): Promise<ForgePullRequest> => {
        prCalls += 1;
        return { number: 9, htmlUrl: "", state: "open", merged: true, headBranch: "b", headSha: "s" };
      },
    });
    const mon = new ForgeMonitor(
      baseDeps({ watchableRuns: watch, resumeRun: (id) => (resumed.push(id), true) }, forge)
    );
    await mon.pollOnce(); // sees merged → records, no resume
    await mon.pollOnce(); // merged set → skips the PR entirely
    expect(resumed).toEqual([]);
    expect(prCalls).toBe(1);
  });
});
