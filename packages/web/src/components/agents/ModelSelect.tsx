import type { ConfiguredModel } from "@otterbot/shared";

/**
 * Pick a configured model by name. Agents reference models by id; the provider
 * and account are carried by the model, so this is the only model decision an
 * agent needs. Models are managed in Settings → Models.
 */
export function ModelSelect({
  models,
  kind,
  value,
  onChange,
  allowNone,
  disabled,
}: {
  models: ConfiguredModel[];
  kind: "chat" | "embedding";
  value: string;
  onChange: (id: string) => void;
  /** Offer a "none" option (e.g. embeddings disabled). */
  allowNone?: boolean;
  /** Render the select as disabled (non-interactive). */
  disabled?: boolean;
}) {
  const options = models.filter((m) => m.kind === kind);
  if (options.length === 0) {
    return (
      <span style={{ fontSize: 12, color: "rgb(var(--muted))" }}>
        No {kind} models configured — add one in Settings → Models.
      </span>
    );
  }
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={select}>
      {/* Keep the current value selectable even if it's been removed. */}
      {value && !options.some((m) => m.id === value) && (
        <option value={value}>{value} (unconfigured)</option>
      )}
      {allowNone && <option value="">None</option>}
      {options.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

const select: React.CSSProperties = {
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
  width: "100%",
};
