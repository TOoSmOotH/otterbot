import { useEffect, useState, useMemo } from "react";
import { cn } from "../../../lib/utils";
import { useToolsStore } from "../../../stores/tools-store";
import { useSkillsStore } from "../../../stores/skills-store";
import { ToolEditorForm } from "./ToolEditorForm";
import { ToolAiAssist } from "./ToolAiAssist";
import type { CustomTool, CustomToolCreate } from "@otterbot/shared";

interface ToolsSubViewProps {
  navigateToName?: string | null;
  onNavigatedTo?: () => void;
}

type SelectedItem =
  | { kind: "builtin"; name: string }
  | { kind: "custom"; tool: CustomTool }
  | null;

export function ToolsSubView({ navigateToName, onNavigatedTo }: ToolsSubViewProps) {
  const customTools = useToolsStore((s) => s.customTools);
  const builtInTools = useToolsStore((s) => s.builtInTools);
  const toolMeta = useToolsStore((s) => s.toolMeta);
  const loading = useToolsStore((s) => s.loading);
  const loadTools = useToolsStore((s) => s.loadTools);
  const createTool = useToolsStore((s) => s.createTool);
  const updateTool = useToolsStore((s) => s.updateTool);
  const deleteTool = useToolsStore((s) => s.deleteTool);
  const testTool = useToolsStore((s) => s.testTool);

  const skills = useSkillsStore((s) => s.skills);
  const loadSkills = useSkillsStore((s) => s.loadSkills);

  const [selected, setSelected] = useState<SelectedItem>(null);
  const [editing, setEditing] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAiAssist, setShowAiAssist] = useState(false);

  // Editor form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formParameters, setFormParameters] = useState<{ name: string; type: "string" | "number" | "boolean"; required: boolean; description: string }[]>([]);
  const [formCode, setFormCode] = useState("");
  const [formTimeout, setFormTimeout] = useState(30000);

  // Test state
  const [testParams, setTestParams] = useState("{}");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    loadTools();
    loadSkills();
  }, []);

  // Navigate to a specific tool when cross-referencing
  useEffect(() => {
    if (!navigateToName) return;
    // Check custom tools first
    const custom = customTools.find((t) => t.name === navigateToName);
    if (custom) {
      selectCustom(custom);
      onNavigatedTo?.();
      return;
    }
    // Check built-in tools
    if (builtInTools.includes(navigateToName)) {
      setSelected({ kind: "builtin", name: navigateToName });
      setEditing(false);
      setIsNew(false);
      onNavigatedTo?.();
    }
  }, [navigateToName, customTools, builtInTools]);

  const selectCustom = (tool: CustomTool) => {
    setSelected({ kind: "custom", tool });
    setEditing(false);
    setIsNew(false);
    setConfirmDelete(false);
    setTestResult(null);
    loadFormFromTool(tool);
  };

  const loadFormFromTool = (tool: CustomTool) => {
    setFormName(tool.name);
    setFormDescription(tool.description);
    setFormParameters([...tool.parameters]);
    setFormCode(tool.code);
    setFormTimeout(tool.timeout);
  };

  const resetFormForNew = () => {
    setSelected(null);
    setFormName("");
    setFormDescription("");
    setFormParameters([]);
    setFormCode("// Tool code here\n// Receives `params` object, must return a string\nreturn JSON.stringify({ result: 'hello' });");
    setFormTimeout(30000);
    setEditing(true);
    setIsNew(true);
    setConfirmDelete(false);
    setTestResult(null);
  };

  const handleSave = async () => {
    const data: CustomToolCreate = {
      name: formName,
      description: formDescription,
      parameters: formParameters,
      code: formCode,
      timeout: formTimeout,
    };

    if (isNew) {
      const created = await createTool(data);
      if (created) {
        selectCustom(created);
      }
    } else if (selected?.kind === "custom") {
      const updated = await updateTool(selected.tool.id, data);
      if (updated) {
        selectCustom(updated);
      }
    }
    setEditing(false);
    setIsNew(false);
  };

  const handleDelete = async () => {
    if (selected?.kind !== "custom") return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    await deleteTool(selected.tool.id);
    setSelected(null);
    setConfirmDelete(false);
  };

  const handleTest = async () => {
    if (selected?.kind !== "custom") return;
    setTesting(true);
    try {
      const params = JSON.parse(testParams);
      const result = await testTool(selected.tool.id, params);
      setTestResult(result.error ? `Error: ${result.error}` : result.result ?? "No output");
    } catch (e) {
      setTestResult(`Invalid JSON params: ${e instanceof Error ? e.message : String(e)}`);
    }
    setTesting(false);
  };

  const handleAiGenerated = (generated: Partial<CustomToolCreate>) => {
    if (generated.name) setFormName(generated.name);
    if (generated.description) setFormDescription(generated.description);
    if (generated.parameters) setFormParameters(generated.parameters as any);
    if (generated.code) setFormCode(generated.code);
    if (generated.timeout) setFormTimeout(generated.timeout);
    setShowAiAssist(false);
  };

  // Find which skills use a given tool
  const usedBySkills = useMemo(() => {
    const toolName = selected?.kind === "builtin" ? selected.name : selected?.kind === "custom" ? selected.tool.name : null;
    if (!toolName) return [];
    return skills.filter((s) => s.meta.tools.includes(toolName));
  }, [selected, skills]);

  return (
    <div className="flex flex-1 overflow-hidden" style={{ minHeight: "400px" }}>
      {/* Sidebar */}
      <div className="w-[240px] border-r border-border overflow-y-auto">
        <div className="p-2">
          <button
            onClick={resetFormForNew}
            className="w-full text-xs text-center py-1.5 rounded-md border border-dashed border-border hover:border-primary/50 hover:text-primary transition-colors"
          >
            + New Tool
          </button>
        </div>

        {loading && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">Loading...</div>
        )}

        {builtInTools.length > 0 && (
          <SidebarGroup label="Built-in">
            {builtInTools.map((name) => (
              <ToolSidebarItem
                key={name}
                name={name}
                description={toolMeta[name]?.description}
                builtIn
                selected={selected?.kind === "builtin" && selected.name === name}
                onClick={() => {
                  setSelected({ kind: "builtin", name });
                  setEditing(false);
                  setIsNew(false);
                  setTestResult(null);
                }}
              />
            ))}
          </SidebarGroup>
        )}

        {customTools.length > 0 && (
          <SidebarGroup label="Custom">
            {customTools.map((tool) => (
              <ToolSidebarItem
                key={tool.id}
                name={tool.name}
                description={tool.description}
                builtIn={false}
                selected={selected?.kind === "custom" && selected.tool.id === tool.id}
                onClick={() => selectCustom(tool)}
              />
            ))}
          </SidebarGroup>
        )}
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto p-5">
        {!selected && !editing ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Select a tool to view details, or create a new custom tool
          </div>
        ) : editing ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{isNew ? "New Tool" : "Edit Tool"}</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAiAssist(!showAiAssist)}
                  className="text-xs bg-secondary text-foreground px-3 py-1 rounded-md hover:bg-secondary/80"
                >
                  AI Assist
                </button>
                <button
                  onClick={handleSave}
                  disabled={!formName.trim() || !formCode.trim()}
                  className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded-md hover:bg-primary/90 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    if (isNew) {
                      setEditing(false);
                      setIsNew(false);
                    } else if (selected?.kind === "custom") {
                      selectCustom(selected.tool);
                    }
                  }}
                  className="text-xs text-muted-foreground px-3 py-1 rounded-md hover:bg-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>

            {showAiAssist && (
              <ToolAiAssist onGenerated={handleAiGenerated} onClose={() => setShowAiAssist(false)} />
            )}

            <ToolEditorForm
              name={formName}
              description={formDescription}
              parameters={formParameters}
              code={formCode}
              timeout={formTimeout}
              onNameChange={setFormName}
              onDescriptionChange={setFormDescription}
              onParametersChange={setFormParameters}
              onCodeChange={setFormCode}
              onTimeoutChange={setFormTimeout}
            />
          </div>
        ) : selected?.kind === "builtin" ? (
          /* Built-in tool read-only view */
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold font-mono">{selected.name}</h3>
              <span className="text-[9px] uppercase tracking-wider text-blue-400">Built-in</span>
            </div>

            {toolMeta[selected.name]?.description && (
              <Field label="Description">
                <p className="text-sm text-muted-foreground">{toolMeta[selected.name].description}</p>
              </Field>
            )}

            {toolMeta[selected.name]?.parameters && toolMeta[selected.name].parameters!.length > 0 && (
              <Field label="Parameters">
                <div className="space-y-1">
                  {toolMeta[selected.name].parameters!.map((p) => (
                    <div key={p.name} className="text-xs">
                      <span className="font-mono text-primary">{p.name}</span>
                      <span className="text-muted-foreground"> ({p.type})</span>
                      {p.required && <span className="text-red-400"> *</span>}
                      {p.description && <span className="text-muted-foreground"> — {p.description}</span>}
                    </div>
                  ))}
                </div>
              </Field>
            )}

            {usedBySkills.length > 0 && (
              <Field label="Used by Skills">
                <div className="flex flex-wrap gap-1">
                  {usedBySkills.map((s) => (
                    <span key={s.id} className="text-[10px] bg-secondary px-2 py-0.5 rounded">
                      {s.meta.name}
                    </span>
                  ))}
                </div>
              </Field>
            )}
          </div>
        ) : selected?.kind === "custom" ? (
          /* Custom tool read-only view */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold font-mono">{selected.tool.name}</h3>
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Custom</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setEditing(true); setIsNew(false); }}
                  className="text-xs bg-secondary text-foreground px-3 py-1 rounded-md hover:bg-secondary/80"
                >
                  Edit
                </button>
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
              </div>
            </div>

            <Field label="Description">
              <p className="text-sm text-muted-foreground">{selected.tool.description || "(none)"}</p>
            </Field>

            {selected.tool.parameters.length > 0 && (
              <Field label="Parameters">
                <div className="space-y-1">
                  {selected.tool.parameters.map((p) => (
                    <div key={p.name} className="text-xs">
                      <span className="font-mono text-primary">{p.name}</span>
                      <span className="text-muted-foreground"> ({p.type})</span>
                      {p.required && <span className="text-red-400"> *</span>}
                      {p.description && <span className="text-muted-foreground"> — {p.description}</span>}
                    </div>
                  ))}
                </div>
              </Field>
            )}

            <Field label="Code">
              <pre className="text-xs text-muted-foreground bg-secondary rounded-md p-3 whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto">
                {selected.tool.code}
              </pre>
            </Field>

            <Field label="Timeout">
              <p className="text-xs font-mono bg-secondary inline-block px-2 py-0.5 rounded">
                {selected.tool.timeout}ms
              </p>
            </Field>

            {usedBySkills.length > 0 && (
              <Field label="Used by Skills">
                <div className="flex flex-wrap gap-1">
                  {usedBySkills.map((s) => (
                    <span key={s.id} className="text-[10px] bg-secondary px-2 py-0.5 rounded">
                      {s.meta.name}
                    </span>
                  ))}
                </div>
              </Field>
            )}

            {/* Test runner */}
            <Field label="Test">
              <div className="space-y-2">
                <textarea
                  value={testParams}
                  onChange={(e) => setTestParams(e.target.value)}
                  rows={3}
                  placeholder='{"param1": "value1"}'
                  className="w-full bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 ring-primary resize-y font-mono"
                />
                <button
                  onClick={handleTest}
                  disabled={testing}
                  className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80 disabled:opacity-50"
                >
                  {testing ? "Running..." : "Run Test"}
                </button>
                {testResult !== null && (
                  <pre className="text-xs bg-secondary rounded-md p-3 whitespace-pre-wrap font-mono max-h-[200px] overflow-y-auto">
                    {testResult}
                  </pre>
                )}
              </div>
            </Field>
          </div>
        ) : null}
      </div>
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

function ToolSidebarItem({
  name,
  description,
  builtIn,
  selected,
  onClick,
}: {
  name: string;
  description?: string;
  builtIn: boolean;
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
        {builtIn && (
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
        <span className="font-medium text-xs truncate font-mono">{name}</span>
      </div>
      {description && (
        <div className="text-[10px] text-muted-foreground truncate">{description}</div>
      )}
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
