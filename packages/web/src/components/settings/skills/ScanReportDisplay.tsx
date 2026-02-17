import type { ScanReport, ScanFinding } from "@otterbot/shared";

const SEVERITY_STYLES: Record<string, string> = {
  error: "bg-red-500/15 text-red-400 border-red-500/30",
  warning: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  info: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

const SEVERITY_LABELS: Record<string, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

const CATEGORY_LABELS: Record<string, string> = {
  "hidden-content": "Hidden Content",
  "prompt-injection": "Prompt Injection",
  "dangerous-tools": "Dangerous Tools",
  exfiltration: "Exfiltration",
};

export function ScanReportDisplay({ report }: { report: ScanReport }) {
  if (report.clean) {
    return (
      <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-400">
        Scan passed — no issues found.
      </div>
    );
  }

  // Group by category
  const grouped = new Map<string, ScanFinding[]>();
  for (const f of report.findings) {
    const list = grouped.get(f.category) ?? [];
    list.push(f);
    grouped.set(f.category, list);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          {report.findings.length} issue{report.findings.length !== 1 ? "s" : ""} found
        </span>
        {report.findings.some((f) => f.severity === "error") && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30">
            Has Errors
          </span>
        )}
      </div>

      {Array.from(grouped.entries()).map(([category, findings]) => (
        <div key={category} className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            {CATEGORY_LABELS[category] ?? category}
          </div>
          {findings.map((f, i) => (
            <div
              key={i}
              className={`rounded-md border px-3 py-2 text-xs ${SEVERITY_STYLES[f.severity] ?? SEVERITY_STYLES.info}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase">
                  {SEVERITY_LABELS[f.severity] ?? f.severity}
                </span>
                {f.line && (
                  <span className="text-[10px] text-muted-foreground">Line {f.line}</span>
                )}
              </div>
              <p className="mt-0.5">{f.message}</p>
              {f.snippet && (
                <pre className="mt-1 text-[10px] font-mono bg-black/20 rounded px-2 py-1 overflow-x-auto">
                  {f.snippet}
                </pre>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
