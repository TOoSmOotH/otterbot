import { useState, useEffect, useCallback } from "react";
import type { SkillMeta, Skill } from "@otterbot/shared";

interface SkillEditorDialogProps {
  open: boolean;
  skill: Skill | null; // null = new skill
  availableTools: string[];
  onClose: () => void;
  onSave: (meta: SkillMeta, body: string) => Promise<void>;
  onSerialize: (meta: SkillMeta, body: string) => string;
  onParse: (raw: string) => { meta: SkillMeta; body: string };
}

export function SkillEditorDialog({
  open,
  skill,
  availableTools,
  onClose,
  onSave,
  onSerialize,
  onParse,
}: SkillEditorDialogProps) {
  const [tab, setTab] = useState<"form" | "raw">("form");
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [author, setAuthor] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState("");
  const [tags, setTags] = useState("");
  const [parameters, setParameters] = useState<{ key: string; type: string; default: string; description: string }[]>([]);
  const [body, setBody] = useState("");

  // Raw tab state
  const [rawContent, setRawContent] = useState("");

  useEffect(() => {
    if (!open) return;
    if (skill) {
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
    } else {
      setName("");
      setDescription("");
      setVersion("1.0.0");
      setAuthor("");
      setTools([]);
      setCapabilities("");
      setTags("");
      setParameters([]);
      setBody("");
    }
    setTab("form");
  }, [open, skill]);

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

  // Sync form → raw when switching to raw tab
  useEffect(() => {
    if (tab === "raw") {
      setRawContent(onSerialize(buildMeta(), body));
    }
  }, [tab]);

  // Sync raw → form when switching to form tab
  const syncRawToForm = useCallback(() => {
    try {
      const { meta, body: parsedBody } = onParse(rawContent);
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
  }, [rawContent, onParse]);

  const handleTabSwitch = useCallback((newTab: "form" | "raw") => {
    if (newTab === "form" && tab === "raw") {
      syncRawToForm();
    }
    setTab(newTab);
  }, [tab, syncRawToForm]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const meta = tab === "raw" ? onParse(rawContent).meta : buildMeta();
      const finalBody = tab === "raw" ? onParse(rawContent).body : body;
      await onSave(meta, finalBody);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [tab, rawContent, buildMeta, body, onSave, onClose, onParse]);

  const toggleTool = useCallback((tool: string) => {
    setTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool],
    );
  }, []);

  const addParameter = useCallback(() => {
    setParameters((prev) => [...prev, { key: "", type: "string", default: "", description: "" }]);
  }, []);

  const removeParameter = useCallback((index: number) => {
    setParameters((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateParameter = useCallback((index: number, field: string, value: string) => {
    setParameters((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    );
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h3 className="text-sm font-semibold">
            {skill ? "Edit Skill" : "New Skill"}
          </h3>
          <div className="flex items-center gap-3">
            {/* Tab switcher */}
            <div className="flex bg-secondary rounded-md">
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
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "form" ? (
            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                  Name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Skill name"
                  className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                  Description
                </label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this skill do?"
                  className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                />
              </div>

              {/* Version & Author */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                    Version
                  </label>
                  <input
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="1.0.0"
                    className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                    Author
                  </label>
                  <input
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder="Your name"
                    className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                  />
                </div>
              </div>

              {/* Tools multi-select */}
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                  Tools
                </label>
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
              </div>

              {/* Capabilities */}
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                  Capabilities (comma-separated)
                </label>
                <input
                  value={capabilities}
                  onChange={(e) => setCapabilities(e.target.value)}
                  placeholder="code-review, security-audit"
                  className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                  Tags (comma-separated)
                </label>
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="code, review"
                  className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                />
              </div>

              {/* Parameters */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Parameters
                  </label>
                  <button
                    onClick={addParameter}
                    className="text-[10px] text-primary hover:text-primary/80 transition-colors"
                  >
                    + Add
                  </button>
                </div>
                {parameters.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No parameters defined.</p>
                ) : (
                  <div className="space-y-2">
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
                  </div>
                )}
              </div>

              {/* System prompt / body */}
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                  System Prompt
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={8}
                  placeholder="You are a helpful assistant that..."
                  className="w-full bg-secondary rounded-md px-3 py-2 text-sm outline-none focus:ring-1 ring-primary resize-y font-mono"
                />
              </div>
            </div>
          ) : (
            /* Raw tab */
            <textarea
              value={rawContent}
              onChange={(e) => setRawContent(e.target.value)}
              className="w-full h-[60vh] bg-secondary rounded-md px-3 py-2 text-sm outline-none focus:ring-1 ring-primary resize-none font-mono"
              spellCheck={false}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground px-3 py-1.5 rounded-md hover:bg-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="text-xs bg-primary text-primary-foreground px-4 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
