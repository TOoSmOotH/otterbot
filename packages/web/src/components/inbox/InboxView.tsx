import { useEffect, useState } from "react";
import { useEmailStore } from "../../stores/email-store";
import type { EmailFolder } from "../../stores/email-store";

/** Map special-use flags to friendly display names */
function folderDisplayName(folder: EmailFolder): string {
  const map: Record<string, string> = {
    "\\Inbox": "Inbox",
    "\\Sent": "Sent",
    "\\Drafts": "Drafts",
    "\\Trash": "Trash",
    "\\Archive": "Archive",
    "\\Junk": "Spam",
  };
  if (folder.specialUse && map[folder.specialUse]) return map[folder.specialUse];
  // Strip common prefixes like "[Gmail]/" or "INBOX."
  return folder.name;
}

export function InboxView() {
  const messages = useEmailStore((s) => s.messages);
  const selectedMessage = useEmailStore((s) => s.selectedMessage);
  const loading = useEmailStore((s) => s.loading);
  const loadingDetail = useEmailStore((s) => s.loadingDetail);
  const error = useEmailStore((s) => s.error);
  const loadMessages = useEmailStore((s) => s.loadMessages);
  const readMessage = useEmailStore((s) => s.readMessage);
  const clearSelection = useEmailStore((s) => s.clearSelection);
  const archiveMessage = useEmailStore((s) => s.archiveMessage);
  const sendEmail = useEmailStore((s) => s.sendEmail);
  const loadMore = useEmailStore((s) => s.loadMore);
  const nextPageToken = useEmailStore((s) => s.nextPageToken);
  const folders = useEmailStore((s) => s.folders);
  const currentFolder = useEmailStore((s) => s.currentFolder);
  const loadFolders = useEmailStore((s) => s.loadFolders);
  const selectFolder = useEmailStore((s) => s.selectFolder);

  const [searchQuery, setSearchQuery] = useState("");
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    loadFolders();
    loadMessages();
  }, []);

  const handleSearch = () => {
    loadMessages(searchQuery || undefined);
  };

  const handleSend = async () => {
    if (!composeTo.trim() || !composeSubject.trim()) return;
    setSending(true);
    const ok = await sendEmail({
      to: composeTo,
      subject: composeSubject,
      body: composeBody,
    });
    setSending(false);
    if (ok) {
      setShowCompose(false);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
    }
  };

  const activeFolderName = folders.find((f) => f.path === currentFolder);
  const folderLabel = activeFolderName
    ? folderDisplayName(activeFolderName)
    : currentFolder;

  if (error && messages.length === 0 && folders.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <p className="text-xs text-muted-foreground">
            {error.includes("not configured")
              ? "Configure email in Settings > Email to use the inbox."
              : error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <div className="flex-1 flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search emails..."
            className="flex-1 bg-secondary rounded px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary"
          />
          <button
            onClick={handleSearch}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5"
          >
            Search
          </button>
        </div>
        <button
          onClick={() => setShowCompose(!showCompose)}
          className="text-xs bg-primary text-primary-foreground px-2.5 py-1.5 rounded hover:bg-primary/90"
        >
          Compose
        </button>
      </div>

      {/* Compose drawer */}
      {showCompose && (
        <div className="border-b border-border bg-secondary/30 p-4 space-y-2">
          <input
            type="text"
            value={composeTo}
            onChange={(e) => setComposeTo(e.target.value)}
            placeholder="To"
            className="w-full bg-secondary rounded px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary"
          />
          <input
            type="text"
            value={composeSubject}
            onChange={(e) => setComposeSubject(e.target.value)}
            placeholder="Subject"
            className="w-full bg-secondary rounded px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary"
          />
          <textarea
            value={composeBody}
            onChange={(e) => setComposeBody(e.target.value)}
            placeholder="Write your message..."
            rows={6}
            className="w-full bg-secondary rounded px-3 py-2 text-xs outline-none focus:ring-1 ring-primary resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleSend}
              disabled={sending || !composeTo.trim() || !composeSubject.trim()}
              className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded hover:bg-primary/90 disabled:opacity-50"
            >
              {sending ? "Sending..." : "Send"}
            </button>
            <button
              onClick={() => setShowCompose(false)}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Three-pane: folders | message list | detail */}
      <div className="flex-1 flex overflow-hidden">
        {/* Folder sidebar */}
        {folders.length > 0 && (
          <div className="w-40 flex-shrink-0 border-r border-border overflow-y-auto">
            {folders.map((folder) => (
              <button
                key={folder.path}
                onClick={() => selectFolder(folder.path)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-secondary/50 transition-colors flex items-center justify-between gap-1 ${
                  currentFolder === folder.path ? "bg-secondary font-medium" : "text-muted-foreground"
                }`}
              >
                <span className="truncate">{folderDisplayName(folder)}</span>
                {folder.unseenMessages > 0 && (
                  <span className="text-[9px] bg-primary text-primary-foreground rounded-full px-1.5 min-w-[1.25rem] text-center flex-shrink-0">
                    {folder.unseenMessages}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Message list */}
        <div className={`${selectedMessage ? "w-2/5" : "flex-1"} border-r border-border overflow-y-auto`}>
          {loading && messages.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-8">
              Loading {folderLabel}...
            </div>
          )}

          {!loading && messages.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-8">
              No emails found.
            </div>
          )}

          {messages.map((msg) => (
            <button
              key={msg.id}
              onClick={() => readMessage(msg.id)}
              className={`w-full text-left px-4 py-2.5 border-b border-border hover:bg-secondary/50 transition-colors ${
                selectedMessage?.id === msg.id ? "bg-secondary" : ""
              } ${msg.isUnread ? "bg-primary/5" : ""}`}
            >
              <div className="flex items-center gap-2">
                {msg.isUnread && (
                  <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                )}
                <span className={`text-xs truncate ${msg.isUnread ? "font-semibold" : ""}`}>
                  {msg.from.replace(/<[^>]+>/, "").trim()}
                </span>
                <span className="text-[9px] text-muted-foreground ml-auto flex-shrink-0">
                  {formatDate(msg.date)}
                </span>
              </div>
              <div className={`text-xs truncate mt-0.5 ${msg.isUnread ? "font-medium" : "text-muted-foreground"}`}>
                {msg.subject || "(no subject)"}
              </div>
              <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                {msg.snippet}
              </div>
            </button>
          ))}

          {nextPageToken && (
            <button
              onClick={loadMore}
              className="w-full text-xs text-primary hover:text-primary/80 py-3 text-center"
            >
              Load more...
            </button>
          )}
        </div>

        {/* Detail pane */}
        {selectedMessage && (
          <div className="flex-1 overflow-y-auto">
            {loadingDetail ? (
              <div className="text-xs text-muted-foreground text-center py-8">Loading...</div>
            ) : (
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">{selectedMessage.subject}</h3>
                    <div className="text-xs text-muted-foreground mt-1">
                      From: {selectedMessage.from}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      To: {selectedMessage.to}
                    </div>
                    {selectedMessage.cc && (
                      <div className="text-xs text-muted-foreground">
                        Cc: {selectedMessage.cc}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {selectedMessage.date}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => archiveMessage(selectedMessage.id)}
                      className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-secondary"
                    >
                      Archive
                    </button>
                    <button
                      onClick={clearSelection}
                      className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-secondary"
                    >
                      Close
                    </button>
                  </div>
                </div>

                {selectedMessage.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedMessage.attachments.map((att, i) => (
                      <span
                        key={i}
                        className="text-[9px] bg-secondary px-2 py-0.5 rounded text-muted-foreground"
                      >
                        {att.filename}
                      </span>
                    ))}
                  </div>
                )}

                <div className="border-t border-border pt-3">
                  <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed">
                    {selectedMessage.body}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}
