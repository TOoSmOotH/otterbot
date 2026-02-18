import { useEffect, useState, useMemo, useCallback } from "react";
import { cn } from "../../lib/utils";
import { useSkillsStore } from "../../stores/skills-store";
import { ImportSkillDialog } from "./skills/ImportSkillDialog";
import { ScanReportDisplay } from "./skills/ScanReportDisplay";
import type { Skill, SkillMeta, ScanReport } from "@otterbot/shared";
import matter from "gray-matter";

interface SkillsSubViewProps {
  navigateToId?: string | null;
  onNavigatedTo?: () => void;
  onNavigateToTool?: (toolName: string) => void;
}

export function SkillsSubView({
  navigateToId,
  onNavigatedTo,
  onNavigateToTool,
}: SkillsSubViewProps) {
  const skills = useSkillsStore((s) => s.skills);
  const loading = useSkillsStore((s) => s.loading);
  const loadSkills = useSkillsStore((s) => s.loadSkills);
  const createSkill = useSkillsStore((s) => s.createSkill);
  const updateSkill = useSkillsStore((s) => s.updateSkill);
  const deleteSkill = useSkillsStore((s) => s.deleteSkill);
  const cloneSkill = useSkillsStore((s) => s.cloneSkill);
  const importSkill = useSkillsStore((s) => s.importSkill);
  const exportSkill = useSkillsStore((s) => s.exportSkill);
  const availableTools = useSkillsStore((s) => s.availableTools);
  const loadAvailableTools = useSkillsStore((s) => s.loadAvailableTools);

  const [selected, setSelected] = useState<Skill | null>(null);
  const [editing, setEditing] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Editor form state
  const [tab, setTab] = useState<"form" | "raw">("form");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [author, setAuthor] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState("");
  const [tags, setTags] = useState("");
  const [parameters, setParameters] = useState<{ key: string; type: string; default: string; description: string }[]>([]);
  const [body, setBody] = useState("");
  const [rawContent, setRawContent] = useState("");

  useEffect(() => {
    loadSkills();
    loadAvailableTools();
  }, []);

  // Navigate to a specific skill when cross-referencing
  useEffect(() => {
    if (navigateToId && skills.length > 0) {
      const target = skills.find((s) => s.id === navigateToId);
      if (target) {
        selectSkill(target);
        onNavigatedTo?.();
      }
    }
  }, [navigateToId, skills]);

  const grouped = useMemo(() => {
    const builtIn = skills.filter((s) => s.source === "built-in");
    const custom = skills.filter((s) => s.source !== "built-in");
    return { builtIn, custom };
  }, [skills]);

  // Agents that use the selected skill
  const [usedByAgents, setUsedByAgents] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!selected) {
      setUsedByAgents([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/registry");
        if (!res.ok) return;
        const entries = await res.json();
        const using: { id: string; name: string }[] = [];
        for (const entry of entries) {
          const skillsRes = await fetch(`/api/registry/${entry.id}/skills`);
          if (!skillsRes.ok) continue;
          const agentSkills = await skillsRes.json();
          if (agentSkills.some((s: { id: string }) => s.id === selected.id)) {
            using.push({ id: entry.id, name: entry.name });
          }
        }
        setUsedByAgents(using);
      } catch {
        setUsedByAgents([]);
      }
    })();
  }, [selected?.id]);

  const selectSkill = (skill: Skill) => {
    setSelected(skill);
    setEditing(false);
    setConfirmDelete(false);
    loadFormFromSkill(skill);
  };

  const loadFormFromSkill = (skill: Skill) => {
    setName(skill.meta.name);
    setDescription(skill.meta.description);
    setVersion(skill.meta.version);
    setAuthor(skill.meta.author);
    setTools([...skill.meta.tools]);
    setCapabilities(skill.meta.capabilities.join(", "));
    setTags(skill.meta.tags.join(", "));
    setParameters(
      Object.entries(skill.meta.parameters).map(([key, def]) => ({
        key,
        type: def.type,
        default: String(def.default ?? ""),
        description: def.description ?? "",
      })),
    );
    setBody(skill.body);
    setTab("form");
  };

  const resetFormForNew = () => {
    setSelected(null);
    setName("");
    setDescription("");
    setVersion("1.0.0");
    setAuthor("");
    setTools([]);
    setCapabilities("");
    setTags("");
    setParameters([]);
    setBody("");
    setTab("form");
    setEditing(true);
    setConfirmDelete(false);
  };

  const buildMeta = useCallback((): SkillMeta => {
    const params: Record<string, { type: string; default?: string; description?: string }> = {};
    for (const p of parameters) {
      if (p.key.trim()) {
        params[p.key.trim()] = {
          type: p.type || "string",
          ...(p.default ? { default: p.default } : {}),
          ...(p.description ? { description: p.description } : {}),
        };
      }
    }
    return {
      name,
      description,
      version,
      author,
      tools,
      capabilities: capabilities.split(",").map((s) => s.trim()).filter(Boolean),
      parameters: params,
      tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
    };
  }, [name, description, version, author, tools, capabilities, tags, parameters]);

  const serializeSkillFile = (meta: SkillMeta, bodyStr: string): string => {
    const frontmatter: Record<string, unknown> = {
      name: meta.name,
      description: meta.description,
      version: meta.version,
      author: meta.author,
    };
    if (meta.tools.length > 0) frontmatter.tools = meta.tools;
    if (meta.capabilities.length > 0) frontmatter.capabilities = meta.capabilities;
    if (Object.keys(meta.parameters).length > 0) frontmatter.parameters = meta.parameters;
    if (meta.tags.length > 0) frontmatter.tags = meta.tags;
    return matter.stringify(bodyStr, frontmatter);
  };

  const parseSkillFile = (raw: string): { meta: SkillMeta; body: string } => {
    const { data, content } = matter(raw);
    return {
      meta: {
        name: data.name ?? "Untitled Skill",
        description: data.description ?? "",
        version: data.version ?? "1.0.0",
        author: data.author ?? "",
        tools: Array.isArray(data.tools) ? data.tools : [],
        capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
        parameters: (data.parameters && typeof data.parameters === "object") ? data.parameters : {},
        tags: Array.isArray(data.tags) ? data.tags : [],
      },
      body: content.trim(),
    };
  };

  // Sync form → raw when switching to raw tab
  useEffect(() => {
    if (tab === "raw" && editing) {
      setRawContent(serializeSkillFile(buildMeta(), body));
    }
  }, [tab]);

  const handleTabSwitch = (newTab: "form" | "raw") => {
    if (newTab === "form" && tab === "raw") {
      try {
        const { meta, body: parsedBody } = parseSkillFile(rawContent);
        setName(meta.name);
        setDescription(meta.description);
        setVersion(meta.version);
        setAuthor(meta.author);
        setTools([...meta.tools]);
        setCapabilities(meta.capabilities.join(", "));
        setTags(meta.tags.join(", "));
        setParameters(
          Object.entries(meta.parameters).map(([key, def]) => ({
            key,
            type: def.type,
            default: String(def.default ?? ""),
            description: def.description ?? "",
          })),
        );
        setBody(parsedBody);
      } catch {
        // Invalid format, stay on raw tab
      }
    }
    setTab(newTab);
  };

  const handleSave = async () => {
    const meta = tab === "raw" ? parseSkillFile(rawContent).meta : buildMeta();
    const finalBody = tab === "raw" ? parseSkillFile(rawContent).body : body;

    if (selected) {
      const updated = await updateSkill(selected.id, { meta, body: finalBody });
      if (updated) {
        selectSkill(updated);
      }
    } else {
      const created = await createSkill({ meta, body: finalBody });
      if (created) {
        selectSkill(created);
      }
    }
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    await deleteSkill(selected.id);
    setSelected(null);
    setConfirmDelete(false);
  };

  const handleClone = async () => {
    if (!selected) return;
    const cloned = await cloneSkill(selected.id);
    if (cloned) {
      selectSkill(cloned);
      setEditing(true);
    }
  };

  const handleExport = async () => {
    if (!selected) return;
    await exportSkill(selected.id);
  };

  const handleImport = async (file: File) => {
    const result = await importSkill(file);
    if (result) {
      selectSkill(result.skill);
      return { scanReport: result.scanReport };
    }
    return null;
  };

  const toggleTool = (tool: string) => {
    setTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool],
    );
  };

  const addParameter = () => {
    setParameters((prev) => [...prev, { key: "", type: "string", default: "", description: "" }]);
  };

  const removeParameter = (index: number) => {
    setParameters((prev) => prev.filter((_, i) => i !== index));
  };

  const updateParameter = (index: number, field: string, value: string) => {
    setParameters((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    );
  };

  const SOURCE_STYLES: Record<string, string> = {
    "built-in": "text-blue-400",
    created: "text-muted-foreground",
    imported: "text-purple-400",
    cloned: "text-orange-400",
  };

  return (
    <div className="flex flex-1 overflow-hidden" style={{ minHeight: "400px" }}>
      {/* Sidebar */}
      <div className="w-[240px] border-r border-border overflow-y-auto">
        <div className="p-2 space-y-1">
          <button
            onClick={resetFormForNew}
            className="w-full text-xs text-center py-1.5 rounded-md border border-dashed border-border hover:border-primary/50 hover:text-primary transition-colors"
          >
            + New Skill
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="w-full text-xs text-center py-1.5 rounded-md border border-dashed border-border hover:border-primary/50 hover:text-primary transition-colors"
          >
            Import
          </button>
        </div>

        {loading && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">Loading...</div>
        )}

        {grouped.builtIn.length > 0 && (
          <SidebarGroup label="Built-in">
            {grouped.builtIn.map((skill) => (
              <SkillSidebarItem
                key={skill.id}
                skill={skill}
                selected={selected?.id === skill.id}
                onClick={() => selectSkill(skill)}
              />
            ))}
          </SidebarGroup>
        )}

        {grouped.custom.length > 0 && (
          <SidebarGroup label="Custom">
            {grouped.custom.map((skill) => (
              <SkillSidebarItem
                key={skill.id}
                skill={skill}
                selected={selected?.id === skill.id}
                onClick={() => selectSkill(skill)}
              />
            ))}
          </SidebarGroup>
        )}
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto p-5">
        {!selected && !editing ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Select a skill to view or edit
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">
                  {editing ? (selected ? "Edit Skill" : "New Skill") : name}
                </h3>
                {selected && (
                  <span className={`text-[9px] uppercase tracking-wider ${SOURCE_STYLES[selected.source] ?? ""}`}>
                    {selected.source}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {editing ? (
                  <>
                    <button
                      onClick={handleSave}
                      disabled={!name.trim()}
                      className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded-md hover:bg-primary/90 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        if (selected) {
                          selectSkill(selected);
                        } else {
                          setEditing(false);
                        }
                      }}
                      className="text-xs text-muted-foreground px-3 py-1 rounded-md hover:bg-secondary"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    {selected?.source !== "built-in" && (
                      <button
                        onClick={() => setEditing(true)}
                        className="text-xs bg-secondary text-foreground px-3 py-1 rounded-md hover:bg-secondary/80"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      onClick={handleClone}
                      className="text-xs bg-secondary text-foreground px-3 py-1 rounded-md hover:bg-secondary/80"
                    >
                      Clone
                    </button>
                    <button
                      onClick={handleExport}
                      className="text-xs bg-secondary text-foreground px-3 py-1 rounded-md hover:bg-secondary/80"
                    >
                      Export
                    </button>
                    {selected?.source !== "built-in" && (
                      <button
                        onClick={handleDelete}
                        className={cn(
                          "text-xs px-3 py-1 rounded-md",
                          confirmDelete
                            ? "bg-destructive text-destructive-foreground"
                            : "text-destructive hover:bg-destructive/10",
                        )}
                      >
                        {confirmDelete ? "Confirm Delete" : "Delete"}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Form/Raw tab switcher (when editing) */}
            {editing && (
              <div className="flex bg-secondary rounded-md w-fit">
                <button
                  onClick={() => handleTabSwitch("form")}
                  className={`text-xs px-3 py-1 rounded-md transition-colors ${
                    tab === "form" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Form
                </button>
                <button
                  onClick={() => handleTabSwitch("raw")}
                  className={`text-xs px-3 py-1 rounded-md transition-colors ${
                    tab === "raw" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Raw
                </button>
              </div>
            )}

            {editing && tab === "raw" ? (
              <textarea
                value={rawContent}
                onChange={(e) => setRawContent(e.target.value)}
                className="w-full h-[60vh] bg-secondary rounded-md px-3 py-2 text-sm outline-none focus:ring-1 ring-primary resize-none font-mono"
                spellCheck={false}
              />
            ) : editing ? (
              /* Edit form */
              <>
                <Field label="Name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Skill name"
                    className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                  />
                </Field>

                <Field label="Description">
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What does this skill do?"
                    className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Version">
                    <input
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      placeholder="1.0.0"
                      className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                    />
                  </Field>
                  <Field label="Author">
                    <input
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                      placeholder="Your name"
                      className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                    />
                  </Field>
                </div>

                <Field label="Tools">
                  <div className="flex flex-wrap gap-1.5">
                    {availableTools.map((tool) => (
                      <button
                        key={tool}
                        onClick={() => toggleTool(tool)}
                        className={`text-[10px] font-mono px-2 py-1 rounded-md border transition-colors ${
                          tools.includes(tool)
                            ? "bg-primary/15 text-primary border-primary/30"
                            : "bg-secondary text-muted-foreground border-transparent hover:border-border"
                        }`}
                      >
                        {tool}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Capabilities (comma-separated)">
                  <input
                    value={capabilities}
                    onChange={(e) => setCapabilities(e.target.value)}
                    placeholder="code-review, security-audit"
                    className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                  />
                </Field>

                <Field label="Tags (comma-separated)">
                  <input
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="code, review"
                    className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                  />
                </Field>

                <Field label="Parameters">
                  <div className="space-y-2">
                    {parameters.length === 0 && (
                      <p className="text-xs text-muted-foreground">No parameters defined.</p>
                    )}
                    {parameters.map((param, i) => (
                      <div key={i} className="flex gap-2 items-start">
                        <input
                          value={param.key}
                          onChange={(e) => updateParameter(i, "key", e.target.value)}
                          placeholder="name"
                          className="flex-1 bg-secondary rounded-md px-2 py-1 text-xs outline-none focus:ring-1 ring-primary font-mono"
                        />
                        <select
                          value={param.type}
                          onChange={(e) => updateParameter(i, "type", e.target.value)}
                          className="bg-secondary rounded-md px-2 py-1 text-xs outline-none focus:ring-1 ring-primary"
                        >
                          <option value="string">string</option>
                          <option value="number">number</option>
                          <option value="boolean">boolean</option>
                        </select>
                        <input
                          value={param.default}
                          onChange={(e) => updateParameter(i, "default", e.target.value)}
                          placeholder="default"
                          className="w-24 bg-secondary rounded-md px-2 py-1 text-xs outline-none focus:ring-1 ring-primary"
                        />
                        <input
                          value={param.description}
                          onChange={(e) => updateParameter(i, "description", e.target.value)}
                          placeholder="description"
                          className="flex-1 bg-secondary rounded-md px-2 py-1 text-xs outline-none focus:ring-1 ring-primary"
                        />
                        <button
                          onClick={() => removeParameter(i)}
                          className="text-muted-foreground hover:text-red-400 transition-colors p-1"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={addParameter}
                      className="text-[10px] text-primary hover:text-primary/80 transition-colors"
                    >
                      + Add Parameter
                    </button>
                  </div>
                </Field>

                <Field label="System Prompt">
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={8}
                    placeholder="You are a helpful assistant that..."
                    className="w-full bg-secondary rounded-md px-3 py-2 text-sm outline-none focus:ring-1 ring-primary resize-y font-mono"
                  />
                </Field>
              </>
            ) : (
              /* Read-only view */
              <>
                <Field label="Description">
                  <p className="text-sm text-muted-foreground">{description || "(none)"}</p>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Version">
                    <p className="text-xs font-mono bg-secondary inline-block px-2 py-0.5 rounded">{version}</p>
                  </Field>
                  <Field label="Author">
                    <p className="text-xs font-mono bg-secondary inline-block px-2 py-0.5 rounded">{author || "(none)"}</p>
                  </Field>
                </div>

                {tools.length > 0 && (
                  <Field label="Tools">
                    <div className="flex flex-wrap gap-1">
                      {tools.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => onNavigateToTool?.(t)}
                          className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded font-mono hover:bg-primary/20 transition-colors cursor-pointer"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </Field>
                )}

                {capabilities && (
                  <Field label="Capabilities">
                    <div className="flex flex-wrap gap-1">
                      {capabilities.split(",").map((c) => c.trim()).filter(Boolean).map((c) => (
                        <span key={c} className="text-[10px] bg-secondary px-2 py-0.5 rounded">{c}</span>
                      ))}
                    </div>
                  </Field>
                )}

                {tags && (
                  <Field label="Tags">
                    <div className="flex flex-wrap gap-1">
                      {tags.split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                        <span key={t} className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">{t}</span>
                      ))}
                    </div>
                  </Field>
                )}

                {Object.keys(selected?.meta.parameters ?? {}).length > 0 && (
                  <Field label="Parameters">
                    <div className="space-y-1">
                      {Object.entries(selected!.meta.parameters).map(([key, def]) => (
                        <div key={key} className="text-xs">
                          <span className="font-mono text-primary">{key}</span>
                          <span className="text-muted-foreground"> ({def.type})</span>
                          {def.description && <span className="text-muted-foreground"> — {def.description}</span>}
                        </div>
                      ))}
                    </div>
                  </Field>
                )}

                {body && (
                  <Field label="System Prompt">
                    <pre className="text-xs text-muted-foreground bg-secondary rounded-md p-3 whitespace-pre-wrap font-mono max-h-[200px] overflow-y-auto">
                      {body}
                    </pre>
                  </Field>
                )}

                {/* Scan status */}
                {selected && selected.scanStatus !== "unscanned" && (
                  <Field label="Scan Status">
                    <ScanReportDisplay
                      report={{
                        clean: selected.scanStatus === "clean",
                        findings: selected.scanFindings,
                      }}
                    />
                  </Field>
                )}

                {/* Used by Agents */}
                {usedByAgents.length > 0 && (
                  <Field label="Used by Agents">
                    <div className="flex flex-wrap gap-1">
                      {usedByAgents.map((a) => (
                        <span key={a.id} className="text-[10px] bg-secondary px-2 py-0.5 rounded">
                          {a.name}
                        </span>
                      ))}
                    </div>
                  </Field>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Import dialog */}
      <ImportSkillDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
      />
    </div>
  );
}

function SidebarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </div>
      {children}
    </div>
  );
}

function SkillSidebarItem({
  skill,
  selected,
  onClick,
}: {
  skill: Skill;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2 text-sm transition-colors",
        selected
          ? "bg-secondary text-foreground"
          : "hover:bg-secondary/50 text-muted-foreground",
      )}
    >
      <div className="flex items-center gap-1.5">
        {skill.source === "built-in" && (
          <svg
            className="w-3 h-3 text-muted-foreground/50 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        )}
        <span className="font-medium text-xs truncate">{skill.meta.name}</span>
      </div>
      <div className="text-[10px] text-muted-foreground truncate">
        {skill.meta.tools.length > 0
          ? `${skill.meta.tools.length} tool${skill.meta.tools.length > 1 ? "s" : ""}`
          : "No tools"}
      </div>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
        {label}
      </label>
      {children}
    </div>
  );
}
