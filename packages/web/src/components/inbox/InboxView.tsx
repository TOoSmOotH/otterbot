import { useEffect, useState } from "react";
import { useGmailStore } from "../../stores/gmail-store";

export function InboxView() {
  const messages = useGmailStore((s) => s.messages);
  const selectedMessage = useGmailStore((s) => s.selectedMessage);
  const loading = useGmailStore((s) => s.loading);
  const loadingDetail = useGmailStore((s) => s.loadingDetail);
  const error = useGmailStore((s) => s.error);
  const loadMessages = useGmailStore((s) => s.loadMessages);
  const readMessage = useGmailStore((s) => s.readMessage);
  const clearSelection = useGmailStore((s) => s.clearSelection);
  const archiveMessage = useGmailStore((s) => s.archiveMessage);
  const sendEmail = useGmailStore((s) => s.sendEmail);
  const loadMore = useGmailStore((s) => s.loadMore);
  const nextPageToken = useGmailStore((s) => s.nextPageToken);

  const [searchQuery, setSearchQuery] = useState("");
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
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

  if (error && messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <p className="text-xs text-muted-foreground">
            {error.includes("not connected")
              ? "Connect your Google account in Settings to use Gmail."
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

      {/* Two-pane: message list + detail */}
      <div className="flex-1 flex overflow-hidden">
        {/* Message list */}
        <div className={`${selectedMessage ? "w-2/5" : "w-full"} border-r border-border overflow-y-auto`}>
          {loading && messages.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-8">Loading inbox...</div>
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
