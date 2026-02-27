import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { SshView } from "./SshView";

const useSshStoreMock = vi.fn();

vi.mock("../../stores/ssh-store", () => ({
  useSshStore: () => useSshStoreMock(),
}));

vi.mock("../../lib/socket", () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn() }),
}));

vi.mock("../code/TerminalView", () => ({
  TerminalView: ({ agentId, readOnly }: { agentId: string; readOnly: boolean }) => (
    <div data-testid="terminal-view" data-agent-id={agentId} data-read-only={String(readOnly)} />
  ),
}));

vi.mock("./SshChat", () => ({
  SshChat: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="ssh-chat" data-session-id={sessionId} />
  ),
}));

vi.mock("react-resizable-panels", () => ({
  Group: ({ direction, autoSaveId, className, children }: {
    direction: string;
    autoSaveId: string;
    className?: string;
    children: ReactNode;
  }) => (
    <div
      data-testid="panel-group"
      data-direction={direction}
      data-autosave-id={autoSaveId}
      className={className}
    >
      {children}
    </div>
  ),
  Panel: ({ minSize, defaultSize, children }: {
    minSize: number;
    defaultSize: number;
    children: ReactNode;
  }) => (
    <div data-testid="panel" data-min-size={String(minSize)} data-default-size={String(defaultSize)}>
      {children}
    </div>
  ),
  Separator: ({ className }: { className?: string }) => (
    <div data-testid="separator" className={className} />
  ),
}));

function makeStore(status: "active" | "completed") {
  const completedAt = status === "completed" ? "2026-02-26T12:30:00.000Z" : undefined;

  return {
    sessions: [
      {
        id: "session-1",
        keyId: "key-1",
        host: "example.com",
        username: "ubuntu",
        startedAt: "2026-02-26T12:00:00.000Z",
        completedAt,
        status,
      },
    ],
    selectedSessionId: "session-1",
    sshKeys: [],
    loadSessions: vi.fn(),
    loadKeys: vi.fn(),
    selectSession: vi.fn(),
    deleteSession: vi.fn(),
    connectToHost: vi.fn(),
    disconnectSession: vi.fn(),
    handleSessionStart: vi.fn(),
    handleSessionEnd: vi.fn(),
  };
}

describe("SshView resize layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders resizable terminal/chat panels with a separator for active sessions", () => {
    useSshStoreMock.mockReturnValue(makeStore("active"));

    const html = renderToStaticMarkup(<SshView />);

    expect(html).toContain('data-testid="panel-group"');
    expect(html).toContain('data-direction="vertical"');
    expect(html).toContain('data-autosave-id="ssh-terminal-chat"');

    expect(html).toContain('data-testid="panel" data-min-size="20" data-default-size="65"');
    expect(html).toContain('data-testid="separator" class="panel-resize-handle-horizontal"');
    expect(html).toContain('data-testid="panel" data-min-size="15" data-default-size="35"');

    expect(html).toContain('data-testid="ssh-chat" data-session-id="session-1"');
    expect(html).toContain('data-testid="terminal-view" data-agent-id="ssh-session-1" data-read-only="false"');
  });

  it("hides chat panel and uses full terminal panel for completed sessions", () => {
    useSshStoreMock.mockReturnValue(makeStore("completed"));

    const html = renderToStaticMarkup(<SshView />);

    expect(html).toContain('data-testid="panel" data-min-size="20" data-default-size="100"');
    expect(html).not.toContain('data-testid="separator"');
    expect(html).not.toContain('data-testid="ssh-chat"');
    expect(html).toContain('data-testid="terminal-view" data-agent-id="ssh-session-1" data-read-only="true"');
    expect(html).toContain("Session ended");
  });
});
