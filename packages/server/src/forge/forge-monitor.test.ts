import { describe, it, expect } from "vitest";
import { ForgeMonitor, type ForgeMonitorDeps, type WatchableRun } from "./forge-monitor.js";
import type { Forge, ForgeIssue, ForgeComment, ForgePullRequest, ForgeReview, CheckState } from "./forge.js";

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
    listOpenIssues: async () => [],
    listIssueComments: async () => [],
    getUserPermission: async () => "none",
    commentIssue: async () => 0,
    ...over,
  };
}

const issue = (number: number, over: Partial<ForgeIssue> = {}): ForgeIssue => ({
  number,
  title: `issue ${number}`,
  body: "body",
  author: "alice",
  assignees: [],
  htmlUrl: "h",
  ...over,
});

function baseDeps(over: Partial<ForgeMonitorDeps>, forge: Forge): ForgeMonitorDeps {
  return {
    listMonitoredProjects: () => [{ id: "p1", forgeRepo: "o/n" }],
    forgeForProject: () => forge,
    hasRunForIssue: () => false,
    startRunFromIssue: () => "run1",
    watchableRuns: () => [],
    resumeRun: () => true,
    listTriageProjects: () => [],
    getTriage: () => null,
    triageInitial: async () => {},
    refinePlan: async () => {},
    advanceWatermark: () => {},
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
        return 0;
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

describe("ForgeMonitor.pollTriage", () => {
  const comment = (id: number, author: string, body = "c"): ForgeComment => ({
    id,
    author,
    body,
    createdAt: "t",
  });

  it("initial-triages a new open unassigned issue, folding existing maintainer comments", async () => {
    const calls: Array<{ n: number; instr: number[] }> = [];
    const forge = fakeForge({
      listOpenIssues: async () => [issue(5)],
      listIssueComments: async () => [comment(10, "alice"), comment(11, "stranger")],
      getUserPermission: async (_r, u) => (u === "stranger" ? "none" : "write"),
    });
    const deps = baseDeps(
      {
        listTriageProjects: () => [{ id: "p1", forgeRepo: "o/n" }],
        getTriage: () => null,
        triageInitial: async (_p, i, instr) => {
          calls.push({ n: i.number, instr: instr.map((c) => c.id) });
        },
      },
      forge
    );
    await new ForgeMonitor(deps).pollOnce();
    expect(calls).toEqual([{ n: 5, instr: [10] }]);
  });

  it("skips assigned issues", async () => {
    let triaged = 0;
    const forge = fakeForge({ listOpenIssues: async () => [issue(6, { assignees: ["bot"] })] });
    const deps = baseDeps(
      { listTriageProjects: () => [{ id: "p1", forgeRepo: "o/n" }], triageInitial: async () => { triaged += 1; } },
      forge
    );
    await new ForgeMonitor(deps).pollOnce();
    expect(triaged).toBe(0);
  });

  it("refines only on new author/maintainer comments above the watermark", async () => {
    const refined: number[] = [];
    const forge = fakeForge({
      listOpenIssues: async () => [issue(7)],
      listIssueComments: async () => [comment(20, "alice", "old"), comment(30, "carol", "please add tests")],
      getUserPermission: async (_r, u) => (u === "carol" ? "write" : "none"),
    });
    const deps = baseDeps(
      {
        listTriageProjects: () => [{ id: "p1", forgeRepo: "o/n" }],
        getTriage: () => ({ plan: "p", lastCommentId: 25 }),
        refinePlan: async (_p, i, _plan, instr) => {
          refined.push(...instr.map((c) => c.id));
        },
      },
      forge
    );
    await new ForgeMonitor(deps).pollOnce();
    expect(refined).toEqual([30]);
  });

  it("advances the watermark (no refine) when new comments are not instructions", async () => {
    let refined = 0;
    let advancedTo = 0;
    const forge = fakeForge({
      listOpenIssues: async () => [issue(8)],
      listIssueComments: async () => [comment(40, "stranger", "noise")],
      getUserPermission: async () => "none",
    });
    const deps = baseDeps(
      {
        listTriageProjects: () => [{ id: "p1", forgeRepo: "o/n" }],
        getTriage: () => ({ plan: "p", lastCommentId: 30 }),
        refinePlan: async () => { refined += 1; },
        advanceWatermark: (_p, _n, id) => { advancedTo = id; },
      },
      forge
    );
    await new ForgeMonitor(deps).pollOnce();
    expect(refined).toBe(0);
    expect(advancedTo).toBe(40);
  });

  it("ignores the bot's own comments", async () => {
    let refined = 0;
    const forge = fakeForge({
      listOpenIssues: async () => [issue(9)],
      listIssueComments: async () => [comment(50, "bot", "the plan")],
    });
    const deps = baseDeps(
      {
        listTriageProjects: () => [{ id: "p1", forgeRepo: "o/n" }],
        getTriage: () => ({ plan: "p", lastCommentId: 40 }),
        refinePlan: async () => { refined += 1; },
      },
      forge
    );
    await new ForgeMonitor(deps).pollOnce();
    expect(refined).toBe(0);
  });
});
