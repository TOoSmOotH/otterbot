import { useRef, useState } from "react";
import { apiFetch, withToken } from "../../lib/api";
import type { AgentProfile } from "@otterbot/shared";
import { initials } from "./agent-visual";

/**
 * Avatar picker for an agent. Uploads the chosen image straight to the agent's
 * avatar endpoint; falls back to the agent's initials when none is set.
 * Requires the agent to already exist (the COO does during onboarding).
 */
export function AvatarUpload({
  agentId,
  name,
  avatar,
  onChange,
  size = 56,
}: {
  agentId: string;
  name: string;
  avatar: string | null;
  onChange?: (profile: AgentProfile) => void;
  size?: number;
}) {
  const [url, setUrl] = useState<string | null>(avatar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch(`/api/agents/${agentId}/avatar`, { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string })?.error ?? "Upload failed.");
        return;
      }
      setUrl((data as AgentProfile).artwork.avatar);
      onChange?.(data as AgentProfile);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/api/agents/${agentId}/avatar`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setUrl(null);
        onChange?.(data as AgentProfile);
      } else {
        setError((data as { error?: string })?.error ?? "Failed to remove avatar.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: 10,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: Math.round(size / 2.6),
          fontWeight: 600,
          background: "rgb(var(--border))",
          color: "rgb(var(--fg))",
          overflow: "hidden",
        }}
      >
        {url ? (
          <img src={withToken(url)} alt="" width={size} height={size} style={{ objectFit: "cover" }} />
        ) : (
          initials(name)
        )}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} style={btn}>
            {busy ? "Uploading…" : url ? "Change image" : "Upload image"}
          </button>
          {url && (
            <button type="button" onClick={remove} disabled={busy} style={btn}>
              Remove
            </button>
          )}
        </div>
        {error ? (
          <span style={{ fontSize: 11, color: "#f87171" }}>{error}</span>
        ) : (
          <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>
            PNG, JPG, WebP or GIF — up to 4 MB.
          </span>
        )}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  padding: "6px 11px",
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 12,
};
