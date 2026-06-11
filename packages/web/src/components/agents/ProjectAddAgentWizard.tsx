import { useState } from "react";
import { User, Users, UserPlus, ArrowLeft, Plus } from "lucide-react";
import type { AgentProfileSummary } from "@otterbot/shared";
import { Icon } from "../ui/Icon";
import { AgentEditor } from "./AgentEditor";
import { useProjectsStore, type Project } from "../../stores/projects-store";

/**
 * "Add agent" for a project's Additional-agents section. Offers either picking
 * an existing agent or creating a brand-new single agent — both join this
 * project as members. Newly created agents default to read-only access; the
 * user can flip that afterward in the member list.
 */
type Step = "menu" | "existing";

export function ProjectAddAgentWizard({
  project,
  candidateAgents,
  onClose,
}: {
  project: Project;
  /** Agents not already in the project, eligible to be added. */
  candidateAgents: AgentProfileSummary[];
  onClose: () => void;
}) {
  const addMember = useProjectsStore((s) => s.addMember);
  const [step, setStep] = useState<Step>("menu");

  // "Single agent" reuses the full-screen AgentEditor (its own modal), and the
  // freshly created agent is auto-added to this project.
  if (step === "single") {
    return (
      <AgentEditor
        agentId={null}
        onCreated={(id) => addMember(project.id, id)}
        onClose={onClose}
      />
    );
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        {step !== "menu" && (
          <button style={backBtn} onClick={() => setStep("menu")}>
            <Icon icon={ArrowLeft} size={14} /> Back
          </button>
        )}
        {step === "menu" && <Menu onPickExisting={() => setStep("existing")} onPickSingle={() => setStep("single")} />}
        {step === "existing" && (
          <ExistingPicker
            candidateAgents={candidateAgents}
            onAdd={async (id, access) => {
              await addMember(project.id, id, access);
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}

function Menu({ onPickExisting, onPickSingle }: { onPickExisting: () => void; onPickSingle: () => void }) {
  return (
    <div>
      <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 600 }}>Add an agent</h2>
      <p style={{ color: "rgb(var(--muted))", fontSize: 12, marginTop: 0 }}>
        Give another agent access to this project's source. Add one you already have, or create a new
        one — either way it joins as a project member.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 12 }}>
        <Card
          icon={Users}
          title="Use an existing agent"
          desc="Pick an agent you've already created and add it to this project."
          onClick={onPickExisting}
        />
        <Card
          icon={UserPlus}
          title="New single agent"
          desc="Create a standalone agent from scratch — it's added to this project automatically."
          onClick={onPickSingle}
        />
      </div>
    </div>
  );
}

function ExistingPicker({
  candidateAgents,
  onAdd,
}: {
  candidateAgents: AgentProfileSummary[];
  onAdd: (agentId: string, access: "read" | "write") => Promise<void>;
}) {
  const [pick, setPick] = useState("");
  const [access, setAccess] = useState<"read" | "write">("read");
  const [busy, setBusy] = useState(false);

  return (
    <div>
      <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600 }}>Use an existing agent</h2>
      {candidateAgents.length === 0 ? (
        <p style={{ fontSize: 12, color: "rgb(var(--muted))" }}>
          No other agents available — they're all already in this project. Create a new one instead.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <select data-testid="add-agent-pick" value={pick} onChange={(e) => setPick(e.target.value)} style={input}>
            <option value="">Select an agent…</option>
            {candidateAgents.map((a) => (
              <option key={a.id} value={a.id}>{a.displayName}</option>
            ))}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            Access:
            <select value={access} onChange={(e) => setAccess(e.target.value as "read" | "write")} style={{ ...input, flex: "none", width: 140 }}>
              <option value="read">read-only</option>
              <option value="write">read-write</option>
            </select>
          </label>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button
          style={primaryBtn}
          data-testid="add-agent-confirm"
          disabled={!pick || busy}
          onClick={async () => {
            setBusy(true);
            await onAdd(pick, access);
          }}
        >
          <Icon icon={Plus} size={14} /> {busy ? "Adding…" : "Add to project"}
        </button>
      </div>
    </div>
  );
}

function Card({ icon, title, desc, onClick }: { icon: typeof User; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={card}>
      <Icon icon={icon} size={18} />
      <div style={{ textAlign: "left" }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
        <div style={{ color: "rgb(var(--muted))", fontSize: 12 }}>{desc}</div>
      </div>
    </button>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};
const modal: React.CSSProperties = {
  width: "min(92vw, 560px)",
  maxHeight: "86vh",
  overflowY: "auto",
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 10,
  padding: 18,
  boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
};
const card: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: 12,
  cursor: "pointer",
};
const input: React.CSSProperties = {
  flex: 1,
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 13,
};
const primaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "rgb(var(--accent))",
  color: "rgb(var(--accent-fg))",
  border: "none",
  borderRadius: 6,
  padding: "7px 14px",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
const backBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "transparent",
  color: "rgb(var(--muted))",
  border: "none",
  cursor: "pointer",
  fontSize: 12,
  padding: 0,
  marginBottom: 8,
};
