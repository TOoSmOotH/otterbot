import { useState } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore, type NamedProvider, type ProviderType } from "../../stores/settings-store";

const TYPE_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  "openai-compatible": "OpenAI-Compatible",
  huggingface: "Hugging Face",
  nvidia: "NVIDIA",
  lmstudio: "LM Studio",
  deepseek: "DeepSeek",
};

export function ProvidersTab() {
  const providers = useSettingsStore((s) => s.providers);
  const providerTypes = useSettingsStore((s) => s.providerTypes);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted-foreground">
          Manage your LLM provider connections. Each provider can have its own name, credentials, and configuration.
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 shrink-0 ml-4"
        >
          Add Provider
        </button>
      </div>

      {showAdd && (
        <AddProviderForm
          providerTypes={providerTypes}
          onClose={() => setShowAdd(false)}
        />
      )}

      {providers.map((provider) => (
        <ProviderCard key={provider.id} provider={provider} />
      ))}

      {providers.length === 0 && !showAdd && (
        <p className="text-xs text-muted-foreground text-center py-8">
          No providers configured yet. Click "Add Provider" to get started.
        </p>
      )}
    </div>
  );
}

function AddProviderForm({
  providerTypes,
  onClose,
}: {
  providerTypes: { type: string; label: string; needsApiKey: boolean; needsBaseUrl: boolean }[];
  onClose: () => void;
}) {
  const createProvider = useSettingsStore((s) => s.createProvider);
  const [type, setType] = useState<ProviderType>("anthropic");
  const [name, setName] = useState("Anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const meta = providerTypes.find((m) => m.type === type);

  const handleTypeChange = (newType: ProviderType) => {
    setType(newType);
    const m = providerTypes.find((p) => p.type === newType);
    setName(m?.label || newType);
    setApiKey("");
    setBaseUrl(newType === "ollama" ? "http://localhost:11434/api" : newType === "lmstudio" ? "http://localhost:1234/v1" : "");
  };

  const handleCreate = async () => {
    setSaving(true);
    const result = await createProvider({
      name,
      type,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
    });
    setSaving(false);
    if (result) onClose();
  };

  return (
    <div className="border border-primary/30 rounded-lg p-4 space-y-3 bg-primary/5">
      <h3 className="text-sm font-medium">New Provider</h3>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Type
          </label>
          <select
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as ProviderType)}
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
          >
            {providerTypes.map((pt) => (
              <option key={pt.type} value={pt.type}>
                {pt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Provider"
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
          />
        </div>
      </div>

      {meta?.needsApiKey && (
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter API key..."
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
          />
        </div>
      )}

      {meta?.needsBaseUrl && (
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Base URL
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://..."
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleCreate}
          disabled={saving || !name.trim()}
          className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Creating..." : "Create"}
        </button>
        <button
          onClick={onClose}
          className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ProviderCard({ provider }: { provider: NamedProvider }) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(provider.name);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [saving, setSaving] = useState(false);

  const updateProvider = useSettingsStore((s) => s.updateProvider);
  const deleteProviderFn = useSettingsStore((s) => s.deleteProvider);
  const testProviderFn = useSettingsStore((s) => s.testProvider);
  const fetchModels = useSettingsStore((s) => s.fetchModels);
  const testResult = useSettingsStore((s) => s.testResults[provider.id]);
  const providerTypes = useSettingsStore((s) => s.providerTypes);

  const meta = providerTypes.find((m) => m.type === provider.type);

  const handleSave = async () => {
    setSaving(true);
    const data: { name?: string; apiKey?: string; baseUrl?: string } = {};
    if (name !== provider.name) data.name = name;
    if (apiKey) data.apiKey = apiKey;
    if (meta?.needsBaseUrl && baseUrl !== (provider.baseUrl ?? "")) data.baseUrl = baseUrl;
    await updateProvider(provider.id, data);
    await fetchModels(provider.id);
    setApiKey("");
    setSaving(false);
  };

  const handleTest = () => {
    testProviderFn(provider.id);
  };

  const handleDelete = async () => {
    const result = await deleteProviderFn(provider.id);
    if (!result.ok) {
      // Error is set in the store
    }
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              provider.apiKeySet || !meta?.needsApiKey ? "bg-green-500" : "bg-zinc-500",
            )}
          />
          <div className="text-left">
            <div className="text-sm font-medium flex items-center gap-2">
              {provider.name}
              <span className="text-[10px] font-normal text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                {TYPE_LABELS[provider.type] ?? provider.type}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              {provider.apiKeySet && provider.apiKeyMasked && (
                <span className="font-mono">{provider.apiKeyMasked}</span>
              )}
              {provider.baseUrl && (
                <span className={provider.apiKeySet ? "ml-2" : ""}>{provider.baseUrl}</span>
              )}
            </div>
          </div>
        </div>
        <span className="text-muted-foreground text-xs">
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-border space-y-3">
          {/* Name */}
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
            />
          </div>

          {/* API Key */}
          {meta?.needsApiKey && (
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  provider.apiKeySet
                    ? `Current: ${provider.apiKeyMasked}`
                    : "Enter API key..."
                }
                className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
              />
            </div>
          )}

          {/* Base URL */}
          {meta?.needsBaseUrl && (
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                Base URL
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://..."
                className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
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
              {testResult?.testing ? "Testing..." : "Test"}
            </button>
            <button
              onClick={handleDelete}
              className="text-xs bg-secondary text-red-400 px-3 py-1.5 rounded-md hover:bg-red-500/20"
            >
              Delete
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
      )}
    </div>
  );
}
