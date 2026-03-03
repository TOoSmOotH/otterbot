import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type HookStates = unknown[];

interface RenderOptions {
  open?: boolean;
  hookStates?: HookStates;
  storeOverrides?: Partial<{
    gitHubTokenSet: boolean;
    gitHubUsername: string | null;
    gitHubTestResult: { testing?: boolean; ok?: boolean; error?: string | null } | null;
  }>;
}

async function renderDialog(options: RenderOptions = {}) {
  vi.resetModules();

  const open = options.open ?? true;
  const hookStates = options.hookStates ?? [];
  const setStateMock = vi.fn();

  const loadGitHubSettings = vi.fn();
  const updateGitHubSettings = vi.fn().mockResolvedValue(undefined);
  const testGitHubConnection = vi.fn();

  const storeState = {
    gitHubTokenSet: false,
    gitHubUsername: null as string | null,
    gitHubTestResult: null as { testing?: boolean; ok?: boolean; error?: string | null } | null,
    loadGitHubSettings,
    updateGitHubSettings,
    testGitHubConnection,
    ...options.storeOverrides,
  };

  vi.doMock("react", async () => {
    const actual = await vi.importActual<typeof import("react")>("react");
    let cursor = 0;

    return {
      ...actual,
      useState: (initial: unknown) => [hookStates[cursor++] ?? initial, setStateMock] as const,
      useEffect: (cb: () => void) => cb(),
    };
  });

  vi.doMock("../../stores/settings-store", () => ({
    useSettingsStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
  }));

  vi.doMock("../../lib/socket", () => ({
    getSocket: () => ({ emit: vi.fn() }),
  }));

  const { CreateProjectDialog } = await import("./CreateProjectDialog");
  const html = renderToStaticMarkup(<CreateProjectDialog open={open} onClose={vi.fn()} />);

  return {
    html,
    loadGitHubSettings,
    updateGitHubSettings,
    testGitHubConnection,
  };
}

describe("CreateProjectDialog PAT dropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unmock("react");
    vi.unmock("../../stores/settings-store");
    vi.unmock("../../lib/socket");
  });

  it("loads GitHub settings when dialog opens", async () => {
    const { loadGitHubSettings } = await renderDialog({ open: true });
    expect(loadGitHubSettings).toHaveBeenCalledTimes(1);
  });

  it("does not load GitHub settings when dialog is closed", async () => {
    const { loadGitHubSettings, html } = await renderDialog({ open: false });

    expect(loadGitHubSettings).not.toHaveBeenCalled();
    expect(html).toBe("");
  });

  it("shows PAT section and connected username for repos when token is configured", async () => {
    const { html } = await renderDialog({
      hookStates: [
        "acme/repo", // githubRepo
        "", // branch
        "", // name
        "", // description
        "", // rules
        false, // issueMonitor
        false, // loading
        null, // error
        true, // showPatSection
        "", // localToken
        false, // savingToken
        false, // tokenSaved
      ],
      storeOverrides: {
        gitHubTokenSet: true,
        gitHubUsername: "octocat",
      },
    });

    expect(html).toContain("Personal Access Token (PAT)");
    expect(html).toContain("Connected as @octocat");
    expect(html).toContain("Create a new token on GitHub");
  });

  it("disables Save Token without token text and disables Test when token is not configured", async () => {
    const { html } = await renderDialog({
      hookStates: [
        "acme/repo", // githubRepo
        "", // branch
        "", // name
        "", // description
        "", // rules
        false, // issueMonitor
        false, // loading
        null, // error
        true, // showPatSection
        "   ", // localToken
        false, // savingToken
        false, // tokenSaved
      ],
      storeOverrides: {
        gitHubTokenSet: false,
      },
    });

    expect(html).toContain("Save Token");
    expect(html).toContain("Test");
    expect(html).toContain("disabled");
    expect(html).toContain("Not set");
  });

  it("shows testing state and success status from GitHub test result", async () => {
    const { html: testingHtml } = await renderDialog({
      hookStates: [
        "acme/repo", // githubRepo
        "", // branch
        "", // name
        "", // description
        "", // rules
        false, // issueMonitor
        false, // loading
        null, // error
        true, // showPatSection
        "ghp_abc", // localToken
        false, // savingToken
        false, // tokenSaved
      ],
      storeOverrides: {
        gitHubTokenSet: true,
        gitHubTestResult: { testing: true },
      },
    });

    expect(testingHtml).toContain("Testing...");

    const { html: connectedHtml } = await renderDialog({
      hookStates: [
        "acme/repo", // githubRepo
        "", // branch
        "", // name
        "", // description
        "", // rules
        false, // issueMonitor
        false, // loading
        null, // error
        true, // showPatSection
        "", // localToken
        false, // savingToken
        true, // tokenSaved
      ],
      storeOverrides: {
        gitHubTokenSet: true,
        gitHubUsername: "octocat",
        gitHubTestResult: { testing: false, ok: true },
      },
    });

    expect(connectedHtml).toContain("Saved");
    expect(connectedHtml).toContain("✓ @octocat");
  });
});
