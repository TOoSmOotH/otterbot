import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useWhatsNewStore, type Release } from "../../stores/whats-new-store";

interface WhatsNewPanelProps {
  open: boolean;
  onClose: () => void;
}

function RelativeTime({ date }: { date: string }) {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let label: string;
  if (diffDays === 0) label = "Today";
  else if (diffDays === 1) label = "Yesterday";
  else if (diffDays < 7) label = `${diffDays} days ago`;
  else if (diffDays < 30) label = `${Math.floor(diffDays / 7)} weeks ago`;
  else if (diffDays < 365) label = `${Math.floor(diffDays / 30)} months ago`;
  else label = `${Math.floor(diffDays / 365)} years ago`;

  return (
    <time dateTime={d.toISOString()} title={d.toLocaleDateString()}>
      {label}
    </time>
  );
}

/** Strip verbose changelog boilerplate so the panel shows clean bullet lists */
function cleanBody(raw: string): string {
  const cleaned = raw
    // Remove the version heading line: "## [0.8.0](url) (date)"
    .replace(/^##\s*\[[\d.]+\].*$/gm, "")
    // Remove "## What's Changed" heading
    .replace(/^##\s*What's Changed\s*/gim, "")
    // Remove "**Full Changelog**: ..." line
    .replace(/\*\*Full Changelog\*\*:.*$/gm, "")
    // Remove inline commit links: ([abcdef1](url))
    .replace(/\s*\(\[[\da-f]+\]\([^)]+\)\)/g, "")
    // Remove inline issue close refs: , closes [#123](url)
    .replace(/,?\s*closes\s*\[#\d+\]\([^)]+\)/gi, "")
    .trim();

  // Deduplicate consecutive bullet lines (release-please often creates dupes)
  const lines = cleaned.split("\n");
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const line of lines) {
    const trimmed = line.replace(/^\s*\*\s*/, "").trim();
    // Only dedup actual bullet lines (start with *)
    if (/^\s*\*\s/.test(line)) {
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
    } else {
      // Reset seen set for new sections (e.g. ### Bug Fixes after ### Features)
      if (/^###?\s/.test(line)) seen.clear();
    }
    deduped.push(line);
  }
  return deduped.join("\n").trim();
}

function ReleaseCard({ release, isNew }: { release: Release; isNew: boolean }) {
  const body = cleanBody(release.body);

  return (
    <div className="border-b border-border last:border-b-0 px-4 py-3 hover:bg-secondary/30 transition-colors">
      <div className="flex items-center gap-2 mb-1">
        {isNew && (
          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
        )}
        <a
          href={release.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-foreground hover:text-primary transition-colors truncate"
        >
          {release.name}
        </a>
        {release.prerelease && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 font-medium shrink-0">
            Pre-release
          </span>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
          <RelativeTime date={release.publishedAt} />
        </span>
      </div>
      {body && (
        <div className="text-[11px] text-muted-foreground leading-relaxed max-w-none [&_ul]:my-0.5 [&_ul]:pl-4 [&_li]:my-0 [&_p]:my-0.5 [&_a]:text-primary [&_h3]:text-[11px] [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:my-1 [&_h2]:text-[11px] [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:my-1">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

export function WhatsNewPanel({ open, onClose }: WhatsNewPanelProps) {
  const releases = useWhatsNewStore((s) => s.releases);
  const loading = useWhatsNewStore((s) => s.loading);
  const error = useWhatsNewStore((s) => s.error);
  const lastSeenTag = useWhatsNewStore((s) => s.lastSeenTag);
  const markAllRead = useWhatsNewStore((s) => s.markAllRead);
  const fetchReleases = useWhatsNewStore((s) => s.fetchReleases);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch releases when panel opens
  useEffect(() => {
    if (open) {
      fetchReleases();
    }
  }, [open]);

  // Mark all read when panel opens (after a short delay so user sees the dots)
  useEffect(() => {
    if (open && releases.length > 0) {
      const timer = setTimeout(() => markAllRead(), 1500);
      return () => clearTimeout(timer);
    }
  }, [open, releases.length]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay listener to avoid closing from the button click that opened it
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [open, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const isNew = (release: Release) => {
    if (!lastSeenTag) return true;
    const idx = releases.findIndex((r) => r.tag === lastSeenTag);
    const releaseIdx = releases.indexOf(release);
    return releaseIdx < idx || idx === -1;
  };

  return (
    <div
      ref={panelRef}
      className="absolute top-full right-0 mt-1 w-[380px] max-h-[480px] bg-card border border-border rounded-lg shadow-xl z-50 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card shrink-0">
        <h3 className="text-xs font-semibold">What's New</h3>
        <a
          href="https://github.com/TOoSmOotH/otterbot/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-muted-foreground hover:text-primary transition-colors"
        >
          View all on GitHub →
        </a>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && releases.length === 0 && (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            <svg className="animate-spin w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" className="opacity-25" />
              <path d="M4 12a8 8 0 0 1 8-8" className="opacity-75" />
            </svg>
            Loading releases...
          </div>
        )}

        {error && (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-muted-foreground">Unable to load releases</p>
            <button
              onClick={() => fetchReleases()}
              className="text-[10px] text-primary hover:underline mt-1"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && releases.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No releases found
          </div>
        )}

        {releases.map((release) => (
          <ReleaseCard key={release.tag} release={release} isNew={isNew(release)} />
        ))}
      </div>
    </div>
  );
}
