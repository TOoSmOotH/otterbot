import { useEffect, useRef } from "react";
import { useFileBrowserStore } from "../../stores/file-browser-store";
import hljs from "highlight.js";

const PREVIEWABLE_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".js", ".ts", ".jsx", ".tsx", ".html", ".css",
  ".py", ".sh", ".bash", ".yaml", ".yml", ".xml", ".csv", ".svg", ".toml",
  ".ini", ".cfg", ".env", ".log", ".sql", ".graphql", ".rs", ".go", ".java",
  ".c", ".cpp", ".h", ".hpp", ".rb", ".php", ".lua", ".vim", ".dockerfile",
  ".makefile", ".gitignore", ".editorconfig",
]);

function isPreviewable(name: string): boolean {
  const lower = name.toLowerCase();
  const dotIdx = lower.lastIndexOf(".");
  if (dotIdx === -1) return false;
  return PREVIEWABLE_EXTENSIONS.has(lower.slice(dotIdx));
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "--";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function extensionToLanguage(name: string): string | undefined {
  const ext = name.toLowerCase().split(".").pop();
  const map: Record<string, string> = {
    js: "javascript", ts: "typescript", jsx: "javascript", tsx: "typescript",
    py: "python", rb: "ruby", sh: "bash", bash: "bash",
    yml: "yaml", yaml: "yaml", md: "markdown", json: "json",
    html: "xml", xml: "xml", svg: "xml", css: "css",
    sql: "sql", rs: "rust", go: "go", java: "java",
    c: "c", cpp: "cpp", h: "c", hpp: "cpp", php: "php", lua: "lua",
    toml: "ini", ini: "ini", graphql: "graphql",
  };
  return ext ? map[ext] : undefined;
}

function HighlightedCode({ code, fileName }: { code: string; fileName: string }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.removeAttribute("data-highlighted");
      hljs.highlightElement(ref.current);
    }
  }, [code, fileName]);

  const lang = extensionToLanguage(fileName);

  return (
    <pre className="text-xs leading-relaxed overflow-auto m-0">
      <code ref={ref} className={lang ? `language-${lang}` : ""}>
        {code}
      </code>
    </pre>
  );
}

export function FileBrowser({ projectId }: { projectId: string }) {
  const {
    currentPath, entries, loading, error,
    previewFile, previewLoading,
    navigateTo, navigateUp, openPreview, closePreview, reset,
  } = useFileBrowserStore();

  useEffect(() => {
    navigateTo(projectId, "");
    return () => reset();
  }, [projectId]);

  const breadcrumbSegments = currentPath.split("/").filter(Boolean);

  const handleFileClick = (name: string) => {
    const filePath = currentPath ? `${currentPath}/${name}` : name;
    if (isPreviewable(name)) {
      openPreview(projectId, filePath, name);
    } else {
      window.open(
        `/api/projects/${projectId}/files/download?path=${encodeURIComponent(filePath)}`,
        "_blank",
      );
    }
  };

  const handleDirClick = (name: string) => {
    const newPath = currentPath ? `${currentPath}/${name}` : name;
    navigateTo(projectId, newPath);
  };

  const handleDownload = (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    const filePath = currentPath ? `${currentPath}/${name}` : name;
    window.open(
      `/api/projects/${projectId}/files/download?path=${encodeURIComponent(filePath)}`,
      "_blank",
    );
  };

  const handleBreadcrumbClick = (index: number) => {
    const path = breadcrumbSegments.slice(0, index + 1).join("/");
    navigateTo(projectId, path);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border text-xs">
        <button
          onClick={() => navigateTo(projectId, "")}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          /
        </button>
        {breadcrumbSegments.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-border">/</span>
            <button
              onClick={() => handleBreadcrumbClick(i)}
              className={`transition-colors ${
                i === breadcrumbSegments.length - 1
                  ? "text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {seg}
            </button>
          </span>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* File listing */}
        <div className={`${previewFile ? "w-1/2 border-r border-border" : "w-full"} overflow-y-auto`}>
          {loading && (
            <div className="flex items-center justify-center h-32">
              <span className="text-xs text-muted-foreground">Loading...</span>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-32">
              <span className="text-xs text-red-400">{error}</span>
            </div>
          )}

          {!loading && !error && (
            <table className="w-full text-xs">
              <tbody>
                {currentPath && (
                  <tr
                    onClick={() => navigateUp(projectId)}
                    className="hover:bg-secondary/50 cursor-pointer border-b border-border/50"
                  >
                    <td className="px-4 py-2 text-muted-foreground" colSpan={3}>
                      <span className="inline-flex items-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
                        ..
                      </span>
                    </td>
                  </tr>
                )}
                {entries.map((entry) => (
                  <tr
                    key={entry.name}
                    onClick={() =>
                      entry.type === "directory"
                        ? handleDirClick(entry.name)
                        : handleFileClick(entry.name)
                    }
                    className="hover:bg-secondary/50 cursor-pointer border-b border-border/50 group"
                  >
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-2">
                        {entry.type === "directory" ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-400 shrink-0">
                            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground shrink-0">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                          </svg>
                        )}
                        <span className={entry.type === "directory" ? "text-blue-400" : "text-foreground"}>
                          {entry.name}{entry.type === "directory" ? "/" : ""}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground text-right whitespace-nowrap">
                      {entry.type === "file" ? formatSize(entry.size) : "--"}
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {entry.type === "file" && (
                        <button
                          onClick={(e) => handleDownload(e, entry.name)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all px-1.5 py-0.5 rounded hover:bg-secondary"
                          title="Download"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && entries.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                      Empty directory
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Preview panel */}
        {previewFile && (
          <div className="w-1/2 flex flex-col min-h-0">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
              <span className="text-xs font-medium truncate">{previewFile.name}</span>
              <div className="flex items-center gap-1 shrink-0">
                {previewFile.truncated && (
                  <span className="text-[10px] text-amber-400 mr-2">
                    Truncated ({formatSize(previewFile.size)})
                  </span>
                )}
                <button
                  onClick={() => {
                    window.open(
                      `/api/projects/${projectId}/files/download?path=${encodeURIComponent(previewFile.path)}`,
                      "_blank",
                    );
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-secondary"
                >
                  Download
                </button>
                <button
                  onClick={closePreview}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-secondary"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-card/50">
              <HighlightedCode code={previewFile.content} fileName={previewFile.name} />
            </div>
          </div>
        )}

        {/* Preview loading overlay */}
        {previewLoading && !previewFile && (
          <div className="w-1/2 flex items-center justify-center">
            <span className="text-xs text-muted-foreground">Loading preview...</span>
          </div>
        )}
      </div>
    </div>
  );
}
