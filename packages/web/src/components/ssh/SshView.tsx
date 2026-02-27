import { useEffect, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useSshStore } from "../../stores/ssh-store";
import { TerminalView } from "../code/TerminalView";
import { SshChat } from "./SshChat";
import { getSocket } from "../../lib/socket";
import type { SshKeyInfo, SshSessionStatus } from "@otterbot/shared";

const STATUS_DOT: Record<SshSessionStatus, string> = {
  active: "bg-green-500",
  completed: "bg-zinc-500",
  error: "bg-red-500",
};

export function SshView() {
  const {
    sessions,
    selectedSessionId,
    sshKeys,
    loadSessions,
    loadKeys,
    selectSession,
    deleteSession,
    connectToHost,
    disconnectSession,
    handleSessionStart,
    handleSessionEnd,
  } = useSshStore();

  const [connectDialog, setConnectDialog] = useState(false);
  const [connectKeyId, setConnectKeyId] = useState("");
  const [connectHost, setConnectHost] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
    loadKeys();

    // Socket listeners
    const socket = getSocket();
    const onStart = (data: { sessionId: string; keyId: string; host: string; username: string; agentId: string }) => {
      handleSessionStart(data);
    };
    const onEnd = (data: { sessionId: string; agentId: string; status: SshSessionStatus }) => {
      handleSessionEnd(data);
    };
    socket.on("ssh:session-start", onStart);
    socket.on("ssh:session-end", onEnd);
    return () => {
      socket.off("ssh:session-start", onStart);
      socket.off("ssh:session-end", onEnd);
    };
  }, []);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const agentId = selectedSession ? `ssh-${selectedSession.id}` : null;

  const handleConnect = async () => {
    if (!connectKeyId || !connectHost.trim()) return;
    setConnecting(true);
    setConnectError(null);
    const result = await connectToHost(connectKeyId, connectHost.trim());
    setConnecting(false);
    if (result.ok) {
      setConnectDialog(false);
      setConnectHost("");
    } else {
      setConnectError(result.error || "Connection failed");
    }
  };

  const handleDisconnect = (sessionId: string) => {
    disconnectSession(sessionId);
  };

  // Get hosts for selected key in connect dialog
  const selectedKey = sshKeys.find((k) => k.id === connectKeyId);

  return (
    <div className="h-full flex">
      {/* Left sidebar: session list */}
      <div className="w-56 border-r border-border flex flex-col bg-card">
        <div className="p-2 border-b border-border flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">SSH Sessions</span>
          <button
            onClick={() => {
              setConnectDialog(true);
              setConnectError(null);
              if (sshKeys.length > 0 && !connectKeyId) {
                setConnectKeyId(sshKeys[0].id);
              }
            }}
            className="text-[10px] px-2 py-0.5 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            Connect
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground text-center">
              No sessions yet. Click Connect to start.
            </div>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => selectSession(session.id)}
                className={`w-full text-left px-3 py-2 border-b border-border hover:bg-secondary/50 transition-colors ${
                  selectedSessionId === session.id ? "bg-secondary" : ""
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[session.status]}`} />
                  <span className="text-xs font-medium truncate">{session.host}</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {session.username} &middot; {new Date(session.startedAt).toLocaleTimeString()}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedSession ? (
          <>
            {/* Session header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${STATUS_DOT[selectedSession.status]}`} />
                <span className="text-sm font-medium">
                  {selectedSession.username}@{selectedSession.host}
                </span>
                <span className="text-xs text-muted-foreground">
                  {selectedSession.status === "active" ? "Connected" : selectedSession.status}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {selectedSession.status === "active" && (
                  <button
                    onClick={() => handleDisconnect(selectedSession.id)}
                    className="text-xs px-2 py-1 rounded text-red-400 hover:bg-red-500/10"
                  >
                    Disconnect
                  </button>
                )}
                {selectedSession.status !== "active" && (
                  <button
                    onClick={() => deleteSession(selectedSession.id)}
                    className="text-xs px-2 py-1 rounded text-muted-foreground hover:bg-secondary"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            {/* Terminal + Chat */}
            <Group direction="vertical" className="flex-1 min-h-0" autoSaveId="ssh-terminal-chat">
              <Panel minSize={20} defaultSize={selectedSession.status === "active" ? 65 : 100}>
                <div className="h-full relative">
                  {agentId && (
                    <TerminalView
                      agentId={agentId}
                      readOnly={selectedSession.status !== "active"}
                    />
                  )}
                  {selectedSession.status !== "active" && (
                    <div className="absolute bottom-0 left-0 right-0 bg-zinc-900/90 border-t border-border px-4 py-2 text-center">
                      <span className="text-xs text-muted-foreground">
                        Session ended
                        {selectedSession.completedAt && (
                          <> &middot; {new Date(selectedSession.completedAt).toLocaleString()}</>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </Panel>
              {selectedSession.status === "active" && (
                <>
                  <Separator className="panel-resize-handle-horizontal" />
                  <Panel minSize={15} defaultSize={35}>
                    <SshChat sessionId={selectedSession.id} />
                  </Panel>
                </>
              )}
            </Group>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            {sessions.length > 0
              ? "Select a session from the sidebar"
              : "No SSH sessions. Click Connect to start one."}
          </div>
        )}
      </div>

      {/* Connect dialog */}
      {connectDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setConnectDialog(false)}>
          <div className="bg-card border border-border rounded-lg p-6 w-96 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold">Connect to Host</h3>

            {sshKeys.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                No SSH keys configured. Go to Settings &gt; SSH Keys to add one.
              </div>
            ) : (
              <>
                <div>
                  <label className="text-xs font-medium block mb-1">SSH Key</label>
                  <select
                    value={connectKeyId}
                    onChange={(e) => {
                      setConnectKeyId(e.target.value);
                      setConnectHost("");
                    }}
                    className="w-full text-sm px-3 py-2 bg-secondary border border-border rounded"
                  >
                    {sshKeys.map((key) => (
                      <option key={key.id} value={key.id}>
                        {key.name} ({key.username})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium block mb-1">Host</label>
                  {selectedKey && selectedKey.allowedHosts.length > 0 ? (
                    <select
                      value={connectHost}
                      onChange={(e) => setConnectHost(e.target.value)}
                      className="w-full text-sm px-3 py-2 bg-secondary border border-border rounded"
                    >
                      <option value="">Select a host...</option>
                      {selectedKey.allowedHosts.map((host) => (
                        <option key={host} value={host}>
                          {host}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      No hosts configured for this key.
                    </div>
                  )}
                </div>

                {connectError && <div className="text-xs text-red-400">{connectError}</div>}

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setConnectDialog(false)}
                    className="text-xs px-3 py-1.5 bg-secondary rounded hover:bg-secondary/80"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConnect}
                    disabled={connecting || !connectHost.trim()}
                    className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                  >
                    {connecting ? "Connecting..." : "Connect"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
