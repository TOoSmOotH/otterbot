import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settings-store";

type SubTab = "opencode" | "claude-code" | "codex" | "gemini-cli";

export function CodingAgentsTab() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("opencode");

  return (
    <div className="p-5 space-y-4">
      <p className="text-xs text-muted-foreground">
        Configure external coding agents that can autonomously implement code changes.
        Each agent is limited to one active session per project to prevent file conflicts.
      </p>

      {/* Sub-tab bar */}
      <div className="flex border-b border-border">
        {([
          { id: "opencode" as const, label: "OpenCode" },
          { id: "claude-code" as const, label: "Claude Code" },
          { id: "codex" as const, label: "Codex" },
          { id: "gemini-cli" as const, label: "Gemini CLI" },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={cn(
              "px-4 py-2 text-xs font-medium transition-colors relative",
              activeSubTab === tab.id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {activeSubTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {activeSubTab === "opencode" && <OpenCodeSection />}
      {activeSubTab === "claude-code" && <ClaudeCodeSection />}
      {activeSubTab === "codex" && <CodexSection />}
      {activeSubTab === "gemini-cli" && <GeminiCliSection />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OpenCode Section (migrated from OpenCodeTab)
// ---------------------------------------------------------------------------

function OpenCodeSection() {
  const enabled = useSettingsStore((s) => s.openCodeEnabled);
  const apiUrl = useSettingsStore((s) => s.openCodeApiUrl);
  const username = useSettingsStore((s) => s.openCodeUsername);
  const passwordSet = useSettingsStore((s) => s.openCodePasswordSet);
  const timeoutMs = useSettingsStore((s) => s.openCodeTimeoutMs);
  const maxIterations = useSettingsStore((s) => s.openCodeMaxIterations);
  const model = useSettingsStore((s) => s.openCodeModel);
  const providerId = useSettingsStore((s) => s.openCodeProviderId);
  const interactive = useSettingsStore((s) => s.openCodeInteractive);
  const testResult = useSettingsStore((s) => s.openCodeTestResult);
  const providers = useSettingsStore((s) => s.providers);
  const loadOpenCodeSettings = useSettingsStore((s) => s.loadOpenCodeSettings);
  const updateOpenCodeSettings = useSettingsStore((s) => s.updateOpenCodeSettings);
  const testOpenCodeConnection = useSettingsStore((s) => s.testOpenCodeConnection);

  const [localApiUrl, setLocalApiUrl] = useState(apiUrl);
  const [localUsername, setLocalUsername] = useState(username);
  const [localPassword, setLocalPassword] = useState("");
  const [localTimeoutMs, setLocalTimeoutMs] = useState(String(timeoutMs));
  const [localMaxIterations, setLocalMaxIterations] = useState(String(maxIterations));
  const [localProviderId, setLocalProviderId] = useState(providerId);
  const [localModel, setLocalModel] = useState(model);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const probeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadOpenCodeSettings(); }, []);

  useEffect(() => {
    setLocalApiUrl(apiUrl);
    setLocalUsername(username);
    setLocalTimeoutMs(String(timeoutMs));
    setLocalMaxIterations(String(maxIterations));
    setLocalProviderId(providerId);
    setLocalModel(model);
  }, [apiUrl, username, timeoutMs, maxIterations, providerId, model]);

  const fetchModels = useCallback(async (pid: string) => {
    if (!pid) { setAvailableModels([]); return; }
    setFetchingModels(true);
    try {
      const res = await fetch(`/api/settings/providers/${pid}/models`);
      if (res.ok) {
        const data = await res.json();
        const models = (data.models ?? data ?? []) as Array<{ id: string } | string>;
        setAvailableModels(models.map((m) => (typeof m === "string" ? m : m.id)));
      }
    } catch { /* silently fail */ } finally { setFetchingModels(false); }
  }, []);

  useEffect(() => {
    if (!localProviderId) return;
    if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
    probeTimerRef.current = setTimeout(() => { fetchModels(localProviderId); }, 300);
    return () => { if (probeTimerRef.current) clearTimeout(probeTimerRef.current); };
  }, [localProviderId, fetchModels]);

  const handleSave = async () => {
    setSaving(true);
    const data: Record<string, unknown> = {
      apiUrl: localApiUrl, username: localUsername,
      timeoutMs: parseInt(localTimeoutMs, 10) || 180000,
      maxIterations: parseInt(localMaxIterations, 10) || 50,
      model: localModel, providerId: localProviderId,
    };
    if (localPassword) data.password = localPassword;
    await updateOpenCodeSettings(data);
    setLocalPassword("");
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Connect to an{" "}
        <a href="https://opencode.ai" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">OpenCode</a>{" "}
        server to delegate complex coding tasks.
      </p>

      <ToggleSwitch checked={enabled} onChange={() => updateOpenCodeSettings({ enabled: !enabled })} label="Enable OpenCode integration" />
      <ToggleSwitch checked={interactive} onChange={() => updateOpenCodeSettings({ interactive: !interactive })} label="Interactive mode" description="Pause and ask for your input instead of running fully autonomously." />

      <div className="border border-border rounded-lg p-4 space-y-3">
        <SelectField label="Provider" value={localProviderId} onChange={(v) => { setLocalProviderId(v); setLocalModel(""); setAvailableModels([]); }}
          options={[{ value: "", label: "Select a provider..." }, ...providers.map((p) => ({ value: p.id, label: `${p.name} (${p.type})` }))]} />
        <InputField label={`Model${fetchingModels ? " (loading...)" : ""}`} value={localModel} onChange={setLocalModel} placeholder="e.g. claude-sonnet-4-5-20250929" list="opencode-models" />
        {availableModels.length > 0 && <datalist id="opencode-models">{availableModels.map((m) => <option key={m} value={m} />)}</datalist>}
        <InputField label="API URL" value={localApiUrl} onChange={setLocalApiUrl} placeholder="http://127.0.0.1:4096" />
        <InputField label="Username (optional)" value={localUsername} onChange={setLocalUsername} placeholder="Leave empty if no auth" />
        <InputField label={`Password (optional)${passwordSet ? " \u2713 Set" : ""}`} value={localPassword} onChange={setLocalPassword} placeholder={passwordSet ? "Enter new password to change" : "OPENCODE_SERVER_PASSWORD"} type="password" />
        <InputField label="Timeout (ms)" value={localTimeoutMs} onChange={setLocalTimeoutMs} placeholder="180000" type="number" />
        <InputField label="Max Iterations" value={localMaxIterations} onChange={setLocalMaxIterations} placeholder="50" type="number" />

        <ActionButtons saving={saving} onSave={handleSave} onTest={testOpenCodeConnection} testResult={testResult} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Claude Code Section
// ---------------------------------------------------------------------------

function ClaudeCodeSection() {
  const enabled = useSettingsStore((s) => s.claudeCodeEnabled);
  const authMode = useSettingsStore((s) => s.claudeCodeAuthMode);
  const apiKeySet = useSettingsStore((s) => s.claudeCodeApiKeySet);
  const model = useSettingsStore((s) => s.claudeCodeModel);
  const approvalMode = useSettingsStore((s) => s.claudeCodeApprovalMode);
  const timeoutMs = useSettingsStore((s) => s.claudeCodeTimeoutMs);
  const maxTurns = useSettingsStore((s) => s.claudeCodeMaxTurns);
  const testResult = useSettingsStore((s) => s.claudeCodeTestResult);
  const loadClaudeCodeSettings = useSettingsStore((s) => s.loadClaudeCodeSettings);
  const updateClaudeCodeSettings = useSettingsStore((s) => s.updateClaudeCodeSettings);
  const testClaudeCodeConnection = useSettingsStore((s) => s.testClaudeCodeConnection);

  const [localApiKey, setLocalApiKey] = useState("");
  const [localModel, setLocalModel] = useState(model);
  const [localApprovalMode, setLocalApprovalMode] = useState(approvalMode);
  const [localTimeoutMs, setLocalTimeoutMs] = useState(String(timeoutMs));
  const [localMaxTurns, setLocalMaxTurns] = useState(String(maxTurns));
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadClaudeCodeSettings(); }, []);
  useEffect(() => {
    setLocalModel(model);
    setLocalApprovalMode(approvalMode);
    setLocalTimeoutMs(String(timeoutMs));
    setLocalMaxTurns(String(maxTurns));
  }, [model, approvalMode, timeoutMs, maxTurns]);

  const handleSave = async () => {
    setSaving(true);
    const data: Record<string, unknown> = {
      ...(authMode === "api-key" ? { model: localModel } : {}),
      approvalMode: localApprovalMode,
      timeoutMs: parseInt(localTimeoutMs, 10) || 1200000,
      maxTurns: parseInt(localMaxTurns, 10) || 50,
    };
    if (localApiKey) data.apiKey = localApiKey;
    await updateClaudeCodeSettings(data);
    setLocalApiKey("");
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Use{" "}
        <a href="https://docs.anthropic.com/en/docs/claude-code" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Claude Code</a>{" "}
        (Anthropic's autonomous coding agent) to delegate coding tasks. Install with:{" "}
        <code className="bg-secondary px-1 py-0.5 rounded text-[11px]">npm install -g @anthropic-ai/claude-code</code>
      </p>

      <ToggleSwitch checked={enabled} onChange={() => updateClaudeCodeSettings({ enabled: !enabled })} label="Enable Claude Code integration" />

      <div className="border border-border rounded-lg p-4 space-y-3">
        <SelectField label="Auth Mode" value={authMode} onChange={(v) => updateClaudeCodeSettings({ authMode: v as "api-key" | "oauth" })}
          options={[{ value: "api-key", label: "API Key" }, { value: "oauth", label: "OAuth (claude login)" }]} />

        {authMode === "api-key" && (
          <InputField label={`API Key${apiKeySet ? " \u2713 Set" : ""}`} value={localApiKey} onChange={setLocalApiKey} placeholder={apiKeySet ? "Enter new key to change" : "ANTHROPIC_API_KEY"} type="password" />
        )}
        {authMode === "oauth" && (
          <p className="text-xs text-muted-foreground bg-secondary/50 p-2 rounded">
            Run <code className="bg-secondary px-1 py-0.5 rounded text-[11px]">claude login</code> in a terminal to authenticate.
          </p>
        )}

        {authMode === "api-key" && (
          <InputField label="Model" value={localModel} onChange={setLocalModel} placeholder="claude-sonnet-4-5-20250929" />
        )}
        <SelectField label="Approval Mode" value={localApprovalMode} onChange={(v) => setLocalApprovalMode(v as "full-auto" | "auto-edit")}
          options={[{ value: "full-auto", label: "Full Auto (YOLO)" }, { value: "auto-edit", label: "Auto Edit (ask for tool use)" }]} />
        <InputField label="Timeout (ms)" value={localTimeoutMs} onChange={setLocalTimeoutMs} placeholder="1200000" type="number" />
        <InputField label="Max Turns" value={localMaxTurns} onChange={setLocalMaxTurns} placeholder="50" type="number" />

        <ActionButtons saving={saving} onSave={handleSave} onTest={testClaudeCodeConnection} testResult={testResult} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Codex Section
// ---------------------------------------------------------------------------

function CodexSection() {
  const enabled = useSettingsStore((s) => s.codexEnabled);
  const authMode = useSettingsStore((s) => s.codexAuthMode);
  const apiKeySet = useSettingsStore((s) => s.codexApiKeySet);
  const model = useSettingsStore((s) => s.codexModel);
  const approvalMode = useSettingsStore((s) => s.codexApprovalMode);
  const timeoutMs = useSettingsStore((s) => s.codexTimeoutMs);
  const testResult = useSettingsStore((s) => s.codexTestResult);
  const loadCodexSettings = useSettingsStore((s) => s.loadCodexSettings);
  const updateCodexSettings = useSettingsStore((s) => s.updateCodexSettings);
  const testCodexConnection = useSettingsStore((s) => s.testCodexConnection);

  const [localApiKey, setLocalApiKey] = useState("");
  const [localModel, setLocalModel] = useState(model);
  const [localApprovalMode, setLocalApprovalMode] = useState(approvalMode);
  const [localTimeoutMs, setLocalTimeoutMs] = useState(String(timeoutMs));
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadCodexSettings(); }, []);
  useEffect(() => {
    setLocalModel(model);
    setLocalApprovalMode(approvalMode);
    setLocalTimeoutMs(String(timeoutMs));
  }, [model, approvalMode, timeoutMs]);

  const handleSave = async () => {
    setSaving(true);
    const data: Record<string, unknown> = {
      model: localModel,
      approvalMode: localApprovalMode,
      timeoutMs: parseInt(localTimeoutMs, 10) || 1200000,
    };
    if (localApiKey) data.apiKey = localApiKey;
    await updateCodexSettings(data);
    setLocalApiKey("");
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Use{" "}
        <a href="https://github.com/openai/codex" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Codex CLI</a>{" "}
        (OpenAI's autonomous coding agent) to delegate coding tasks. Install with:{" "}
        <code className="bg-secondary px-1 py-0.5 rounded text-[11px]">npm install -g @openai/codex</code>
      </p>

      <ToggleSwitch checked={enabled} onChange={() => updateCodexSettings({ enabled: !enabled })} label="Enable Codex integration" />

      <div className="border border-border rounded-lg p-4 space-y-3">
        <SelectField label="Auth Mode" value={authMode} onChange={(v) => updateCodexSettings({ authMode: v as "api-key" | "oauth" })}
          options={[{ value: "api-key", label: "API Key" }, { value: "oauth", label: "OAuth (codex login)" }]} />

        {authMode === "api-key" && (
          <InputField label={`API Key${apiKeySet ? " \u2713 Set" : ""}`} value={localApiKey} onChange={setLocalApiKey} placeholder={apiKeySet ? "Enter new key to change" : "OPENAI_API_KEY"} type="password" />
        )}
        {authMode === "oauth" && (
          <p className="text-xs text-muted-foreground bg-secondary/50 p-2 rounded">
            Run <code className="bg-secondary px-1 py-0.5 rounded text-[11px]">codex login</code> in a terminal to authenticate.
          </p>
        )}

        <InputField label="Model" value={localModel} onChange={setLocalModel} placeholder="codex-mini" />
        <SelectField label="Approval Mode" value={localApprovalMode} onChange={(v) => setLocalApprovalMode(v as "full-auto" | "suggest" | "ask")}
          options={[{ value: "full-auto", label: "Full Auto" }, { value: "suggest", label: "Suggest" }, { value: "ask", label: "Ask" }]} />
        <InputField label="Timeout (ms)" value={localTimeoutMs} onChange={setLocalTimeoutMs} placeholder="1200000" type="number" />

        <ActionButtons saving={saving} onSave={handleSave} onTest={testCodexConnection} testResult={testResult} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gemini CLI Section
// ---------------------------------------------------------------------------

function GeminiCliSection() {
  const enabled = useSettingsStore((s) => s.geminiCliEnabled);
  const authMode = useSettingsStore((s) => s.geminiCliAuthMode);
  const apiKeySet = useSettingsStore((s) => s.geminiCliApiKeySet);
  const model = useSettingsStore((s) => s.geminiCliModel);
  const approvalMode = useSettingsStore((s) => s.geminiCliApprovalMode);
  const timeoutMs = useSettingsStore((s) => s.geminiCliTimeoutMs);
  const sandbox = useSettingsStore((s) => s.geminiCliSandbox);
  const testResult = useSettingsStore((s) => s.geminiCliTestResult);
  const loadGeminiCliSettings = useSettingsStore((s) => s.loadGeminiCliSettings);
  const updateGeminiCliSettings = useSettingsStore((s) => s.updateGeminiCliSettings);
  const testGeminiCliConnection = useSettingsStore((s) => s.testGeminiCliConnection);

  const [localApiKey, setLocalApiKey] = useState("");
  const [localModel, setLocalModel] = useState(model);
  const [localApprovalMode, setLocalApprovalMode] = useState(approvalMode);
  const [localTimeoutMs, setLocalTimeoutMs] = useState(String(timeoutMs));
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadGeminiCliSettings(); }, []);
  useEffect(() => {
    setLocalModel(model);
    setLocalApprovalMode(approvalMode);
    setLocalTimeoutMs(String(timeoutMs));
  }, [model, approvalMode, timeoutMs]);

  const handleSave = async () => {
    setSaving(true);
    const data: Record<string, unknown> = {
      ...(authMode === "api-key" ? { model: localModel } : {}),
      approvalMode: localApprovalMode,
      timeoutMs: parseInt(localTimeoutMs, 10) || 1200000,
    };
    if (localApiKey) data.apiKey = localApiKey;
    await updateGeminiCliSettings(data);
    setLocalApiKey("");
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Use{" "}
        <a href="https://github.com/google-gemini/gemini-cli" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Gemini CLI</a>{" "}
        (Google's autonomous AI coding agent) to delegate coding tasks. Install with:{" "}
        <code className="bg-secondary px-1 py-0.5 rounded text-[11px]">npm install -g @google/gemini-cli</code>
      </p>

      <ToggleSwitch checked={enabled} onChange={() => updateGeminiCliSettings({ enabled: !enabled })} label="Enable Gemini CLI integration" />

      <div className="border border-border rounded-lg p-4 space-y-3">
        <SelectField label="Auth Mode" value={authMode} onChange={(v) => updateGeminiCliSettings({ authMode: v as "api-key" | "oauth" })}
          options={[{ value: "api-key", label: "API Key" }, { value: "oauth", label: "OAuth (gemini login)" }]} />

        {authMode === "api-key" && (
          <InputField label={`API Key${apiKeySet ? " \u2713 Set" : ""}`} value={localApiKey} onChange={setLocalApiKey} placeholder={apiKeySet ? "Enter new key to change" : "GEMINI_API_KEY"} type="password" />
        )}
        {authMode === "oauth" && (
          <p className="text-xs text-muted-foreground bg-secondary/50 p-2 rounded">
            Run <code className="bg-secondary px-1 py-0.5 rounded text-[11px]">gemini login</code> in a terminal to authenticate with your Google account.
          </p>
        )}

        {authMode === "api-key" && (
          <InputField label="Model" value={localModel} onChange={setLocalModel} placeholder="gemini-2.5-flash" />
        )}
        <SelectField label="Approval Mode" value={localApprovalMode} onChange={(v) => setLocalApprovalMode(v as "full-auto" | "auto-edit" | "default")}
          options={[{ value: "full-auto", label: "YOLO (Full Auto)" }, { value: "auto-edit", label: "Auto Edit" }, { value: "default", label: "Default (Ask)" }]} />
        <ToggleSwitch checked={sandbox} onChange={() => updateGeminiCliSettings({ sandbox: !sandbox })} label="Sandbox mode" description="Run in Docker isolation for added safety." />
        <InputField label="Timeout (ms)" value={localTimeoutMs} onChange={setLocalTimeoutMs} placeholder="1200000" type="number" />

        <ActionButtons saving={saving} onSave={handleSave} onTest={testGeminiCliConnection} testResult={testResult} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI components
// ---------------------------------------------------------------------------

function ToggleSwitch({ checked, onChange, label, description }: { checked: boolean; onChange: () => void; label: string; description?: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <button onClick={onChange}
        className={cn("relative w-9 h-5 rounded-full transition-colors", checked ? "bg-primary" : "bg-secondary")}>
        <span className={cn("absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform", checked && "translate-x-4")} />
      </button>
      <div>
        <span className="text-sm">{label}</span>
        {description && <p className="text-[10px] text-muted-foreground">{description}</p>}
      </div>
    </label>
  );
}

function InputField({ label, value, onChange, placeholder, type = "text", list }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; list?: string;
}) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} list={list}
        className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary" />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function ActionButtons({ saving, onSave, onTest, testResult }: {
  saving: boolean; onSave: () => void; onTest: () => void;
  testResult: { ok: boolean; error?: string; testing: boolean } | null;
}) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <button onClick={onSave} disabled={saving}
        className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50">
        {saving ? "Saving..." : "Save"}
      </button>
      <button onClick={onTest} disabled={testResult?.testing}
        className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80 disabled:opacity-50">
        {testResult?.testing ? "Testing..." : "Test Connection"}
      </button>
      {testResult && !testResult.testing && (
        <span className={cn("text-xs", testResult.ok ? "text-green-500" : "text-red-500")}>
          {testResult.ok ? "\u2713 Connected" : `\u2717 ${testResult.error ?? "Failed"}`}
        </span>
      )}
    </div>
  );
}
