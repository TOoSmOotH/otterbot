import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

/** Mirrors the server's `BuiltinModelStatus`. */
interface BuiltinModelStatus {
  modelId: string;
  dimension: number;
  downloaded: boolean;
  downloading: boolean;
  error: string | null;
}

/**
 * Status + "Download model" control for the built-in CPU embedder. The ~30 MB
 * model is fetched only when the user clicks the button — never automatically.
 * Self-contained: used by both the onboarding wizard and Global Settings.
 */
export function BuiltinEmbedderControls() {
  const [status, setStatus] = useState<BuiltinModelStatus | null>(null);

  const refresh = () =>
    apiFetch("/api/embedder/builtin/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});

  useEffect(() => void refresh(), []);

  // Poll while a download is in progress.
  useEffect(() => {
    if (!status?.downloading) return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [status?.downloading]);

  const download = async () => {
    setStatus((s) => (s ? { ...s, downloading: true, error: null } : s));
    try {
      const res = await apiFetch("/api/embedder/builtin/download", { method: "POST" });
      setStatus(await res.json());
    } catch {
      void refresh();
    }
  };

  if (!status) return null;

  if (status.downloaded) {
    return (
      <div style={{ fontSize: 12, color: "#4ade80" }}>
        ✓ Built-in model ready — runs on your CPU, fully offline.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, color: "rgb(var(--muted))", lineHeight: 1.5 }}>
        Runs on your CPU, in-process — no API key, no server, no Ollama. Download
        the model (~30 MB) once; afterwards it works fully offline.
      </span>
      <button onClick={download} disabled={status.downloading} style={downloadBtn}>
        {status.downloading ? "Downloading… (~30 MB)" : "Download model (~30 MB)"}
      </button>
      {status.error && <span style={{ fontSize: 12, color: "#f87171" }}>✗ {status.error}</span>}
    </div>
  );
}

const downloadBtn: React.CSSProperties = {
  alignSelf: "flex-start",
  background: "rgb(var(--accent))",
  color: "white",
  border: "none",
  padding: "7px 13px",
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
