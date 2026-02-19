import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settings-store";

export function OpenCodeTab() {
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
  const updateOpenCodeSettings = useSettingsStore(
    (s) => s.updateOpenCodeSettings,
  );
  const testOpenCodeConnection = useSettingsStore(
    (s) => s.testOpenCodeConnection,
  );

  const [localApiUrl, setLocalApiUrl] = useState(apiUrl);
  const [localUsername, setLocalUsername] = useState(username);
  const [localPassword, setLocalPassword] = useState("");
  const [localTimeoutMs, setLocalTimeoutMs] = useState(String(timeoutMs));
  const [localMaxIterations, setLocalMaxIterations] = useState(
    String(maxIterations),
  );
  const [localProviderId, setLocalProviderId] = useState(providerId);
  const [localModel, setLocalModel] = useState(model);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const probeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadOpenCodeSettings();
  }, []);

  // Sync local state when store updates
  useEffect(() => {
    setLocalApiUrl(apiUrl);
    setLocalUsername(username);
    setLocalTimeoutMs(String(timeoutMs));
    setLocalMaxIterations(String(maxIterations));
    setLocalProviderId(providerId);
    setLocalModel(model);
  }, [apiUrl, username, timeoutMs, maxIterations, providerId, model]);

  // Fetch models when provider changes
  const fetchModels = useCallback(async (pid: string) => {
    if (!pid) {
      setAvailableModels([]);
      return;
    }
    setFetchingModels(true);
    try {
      const res = await fetch(`/api/settings/providers/${pid}/models`);
      if (res.ok) {
        const data = await res.json();
        const models = (data.models ?? data ?? []) as Array<{ id: string } | string>;
        setAvailableModels(
          models.map((m) => (typeof m === "string" ? m : m.id)),
        );
      }
    } catch {
      // Silently fail
    } finally {
      setFetchingModels(false);
    }
  }, []);

  useEffect(() => {
    if (!localProviderId) return;
    if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
    probeTimerRef.current = setTimeout(() => {
      fetchModels(localProviderId);
    }, 300);
    return () => {
      if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
    };
  }, [localProviderId, fetchModels]);

  const handleSave = async () => {
    setSaving(true);
    const data: Record<string, unknown> = {
      apiUrl: localApiUrl,
      username: localUsername,
      timeoutMs: parseInt(localTimeoutMs, 10) || 180000,
      maxIterations: parseInt(localMaxIterations, 10) || 50,
      model: localModel,
      providerId: localProviderId,
    };
    if (localPassword) {
      data.password = localPassword;
    }
    await updateOpenCodeSettings(data);
    setLocalPassword("");
    setSaving(false);
  };

  const handleToggleEnabled = async () => {
    await updateOpenCodeSettings({ enabled: !enabled });
  };

  const handleTest = () => {
    testOpenCodeConnection();
  };

  return (
    <div className="p-5 space-y-4">
      <p className="text-xs text-muted-foreground">
        Connect to an{" "}
        <a
          href="https://opencode.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          OpenCode
        </a>{" "}
        server to delegate complex coding tasks. Start the server with{" "}
        <code className="bg-secondary px-1 py-0.5 rounded text-[11px]">
          opencode serve
        </code>
        .
      </p>

      {/* Enable toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <button
          onClick={handleToggleEnabled}
          className={cn(
            "relative w-9 h-5 rounded-full transition-colors",
            enabled ? "bg-primary" : "bg-secondary",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform",
              enabled && "translate-x-4",
            )}
          />
        </button>
        <span className="text-sm">Enable OpenCode integration</span>
      </label>

      {/* Interactive mode toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <button
          onClick={() => updateOpenCodeSettings({ interactive: !interactive })}
          className={cn(
            "relative w-9 h-5 rounded-full transition-colors",
            interactive ? "bg-primary" : "bg-secondary",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform",
              interactive && "translate-x-4",
            )}
          />
        </button>
        <div>
          <span className="text-sm">Interactive mode</span>
          <p className="text-[10px] text-muted-foreground">
            Pause and ask for your input instead of running fully autonomously. Respond in the Code tab.
          </p>
        </div>
      </label>

      <div className="border border-border rounded-lg p-4 space-y-3">
        {/* Provider */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Provider
          </label>
          <select
            value={localProviderId}
            onChange={(e) => {
              setLocalProviderId(e.target.value);
              setLocalModel("");
              setAvailableModels([]);
            }}
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
          >
            <option value="">Select a provider...</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.type})
              </option>
            ))}
          </select>
        </div>

        {/* Model */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Model{" "}
            {fetchingModels && (
              <span className="normal-case tracking-normal text-muted-foreground">
                (loading...)
              </span>
            )}
          </label>
          <input
            type="text"
            value={localModel}
            onChange={(e) => setLocalModel(e.target.value)}
            placeholder="e.g. claude-sonnet-4-5-20250929"
            list="opencode-models"
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
          />
          {availableModels.length > 0 && (
            <datalist id="opencode-models">
              {availableModels.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
          <p className="text-[10px] text-muted-foreground mt-1">
            The model OpenCode will use for coding tasks. Type to enter or select from available models.
          </p>
        </div>

        {/* API URL */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            API URL
          </label>
          <input
            type="text"
            value={localApiUrl}
            onChange={(e) => setLocalApiUrl(e.target.value)}
            placeholder="http://127.0.0.1:4096"
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
          />
        </div>

        {/* Username */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Username{" "}
            <span className="normal-case tracking-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={localUsername}
            onChange={(e) => setLocalUsername(e.target.value)}
            placeholder="Leave empty if no auth"
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
          />
        </div>

        {/* Password */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Password{" "}
            <span className="normal-case tracking-normal">(optional)</span>
            {passwordSet && (
              <span className="ml-2 text-green-500 normal-case tracking-normal">
                Set
              </span>
            )}
          </label>
          <input
            type="password"
            value={localPassword}
            onChange={(e) => setLocalPassword(e.target.value)}
            placeholder={
              passwordSet ? "Enter new password to change" : "OPENCODE_SERVER_PASSWORD"
            }
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
          />
        </div>

        {/* Timeout */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Timeout (ms)
          </label>
          <input
            type="number"
            value={localTimeoutMs}
            onChange={(e) => setLocalTimeoutMs(e.target.value)}
            placeholder="180000"
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            How long to wait for OpenCode to finish a task (default: 180000ms /
            3 minutes)
          </p>
        </div>

        {/* Max Iterations */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Max Iterations
          </label>
          <input
            type="number"
            value={localMaxIterations}
            onChange={(e) => setLocalMaxIterations(e.target.value)}
            placeholder="50"
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Maximum number of OpenCode tool-use iterations per task (default:
            50)
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={handleTest}
            disabled={testResult?.testing}
            className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80 disabled:opacity-50"
          >
            {testResult?.testing ? "Testing..." : "Test Connection"}
          </button>

          {testResult && !testResult.testing && (
            <span
              className={cn(
                "text-xs",
                testResult.ok ? "text-green-500" : "text-red-500",
              )}
            >
              {testResult.ok
                ? "\u2713 Connected"
                : `\u2717 ${testResult.error ?? "Failed"}`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
