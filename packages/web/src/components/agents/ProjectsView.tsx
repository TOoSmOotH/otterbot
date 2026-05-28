import { useEffect, useState } from "react";
import { FolderGit2, Plus, Trash2, X } from "lucide-react";
import { Icon } from "../ui/Icon";
import { useProjectsStore } from "../../stores/projects-store";
import { useAgentsStore } from "../../stores/agents-store";

/**
 * Manage collaborative projects: a project is a shared git working tree bound
 * into each member agent's sandbox at `/project`. Members edit one codebase
 * together (e.g. one writes code, another writes tests). Coding runs are
 * serialized per project on the server.
 */
export function ProjectsView() {
  const projects = useProjectsStore((s) => s.projects);
  const error = useProjectsStore((s) => s.error);
  const load = useProjectsStore((s) => s.load);
  const create = useProjectsStore((s) => s.create);
  const remove = useProjectsStore((s) => s.remove);
  const addMember = useProjectsStore((s) => s.addMember);
  const removeMember = useProjectsStore((s) => s.removeMember);
  const agents = useAgentsStore((s) => s.agents);

  const [name, setName] = useState("");

  useEffect(() => {
    void load();
  }, [load]);

  const nameFor = (id: string) => agents.find((a) => a.id === id)?.displayName ?? id;

  return (
    <div style={{ padding: 20, overflowY: "auto", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Icon icon={FolderGit2} size={18} />
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Projects</h2>
      </div>
      <p style={{ color: "rgb(var(--muted))", fontSize: 12, maxWidth: 640, marginTop: 0 }}>
        A project is a shared git working tree. Add agents as members and they collaborate on
        one codebase via the <code>coding_cli_run</code> tool (Coding CLI agents capability).
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void create(name.trim());
          setName("");
        }}
        style={{ display: "flex", gap: 8, margin: "16px 0", maxWidth: 480 }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New project name"
          style={input}
        />
        <button type="submit" style={primaryBtn}>
          <Icon icon={Plus} size={14} /> Create
        </button>
      </form>
      {error && <div style={{ color: "rgb(var(--danger, 220 60 60))", fontSize: 12 }}>{error}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
        {projects.length === 0 && (
          <div style={{ color: "rgb(var(--muted))", fontSize: 13 }}>No projects yet.</div>
        )}
        {projects.map((p) => {
          const nonMembers = agents.filter((a) => !p.members.includes(a.id));
          return (
            <div key={p.id} style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</span>
                <span style={{ flex: 1 }} />
                <button
                  style={iconBtn}
                  title="Delete project"
                  onClick={() => {
                    if (confirm(`Delete project "${p.name}"? Its code tree is removed.`)) {
                      void remove(p.id);
                    }
                  }}
                >
                  <Icon icon={Trash2} size={14} />
                </button>
              </div>
              <div style={{ color: "rgb(var(--muted))", fontSize: 11, marginTop: 2 }}>
                {p.repoPath}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {p.members.length === 0 && (
                  <span style={{ color: "rgb(var(--muted))", fontSize: 12 }}>No members.</span>
                )}
                {p.members.map((m) => (
                  <span key={m} style={chip}>
                    {nameFor(m)}
                    <button
                      style={chipX}
                      title="Remove member"
                      onClick={() => void removeMember(p.id, m)}
                    >
                      <Icon icon={X} size={11} />
                    </button>
                  </span>
                ))}
              </div>

              {nonMembers.length > 0 && (
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) void addMember(p.id, e.target.value);
                    e.target.value = "";
                  }}
                  style={{ ...input, marginTop: 10, maxWidth: 240 }}
                >
                  <option value="" disabled>
                    Add a member…
                  </option>
                  {nonMembers.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "6px 12px",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const card: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: 12,
  background: "rgb(var(--bg))",
  maxWidth: 640,
};

const chip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "rgb(var(--surface, 30 30 36))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 12,
  padding: "2px 6px 2px 10px",
  fontSize: 12,
};

const chipX: React.CSSProperties = {
  display: "inline-flex",
  background: "transparent",
  border: "none",
  color: "rgb(var(--muted))",
  cursor: "pointer",
  padding: 0,
};

const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  background: "transparent",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  color: "rgb(var(--muted))",
  cursor: "pointer",
  padding: "3px 6px",
};
