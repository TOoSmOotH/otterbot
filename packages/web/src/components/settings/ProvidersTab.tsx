import { useState } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore, type ProviderConfig } from "../../stores/settings-store";

export function ProvidersTab() {
  const providers = useSettingsStore((s) => s.providers);

  return (
    <div className="p-5 space-y-3">
      <p className="text-xs text-muted-foreground mb-4">
        Configure API keys and base URLs for your LLM providers.
      </p>
      {providers.map((provider) => (
        <ProviderCard key={provider.id} provider={provider} />
      ))}
    </div>
  );
}

function ProviderCard({ provider }: { provider: ProviderConfig }) {
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [saving, setSaving] = useState(false);

  const updateProvider = useSettingsStore((s) => s.updateProvider);
  const testProviderFn = useSettingsStore((s) => s.testProvider);
  const fetchModels = useSettingsStore((s) => s.fetchModels);
  const testResult = useSettingsStore((s) => s.testResults[provider.id]);

  const isConfigured = provider.apiKeySet || !provider.needsApiKey;

  const handleSave = async () => {
    setSaving(true);
    const data: { apiKey?: string; baseUrl?: string } = {};
    if (provider.needsApiKey && apiKey) {
      data.apiKey = apiKey;
    }
    if (provider.needsBaseUrl) {
      data.baseUrl = baseUrl;
    }
    await updateProvider(provider.id, data);
    // After saving credentials, fetch available models
    await fetchModels(provider.id);
    setApiKey("");
    setSaving(false);
  };

  const handleTest = () => {
    testProviderFn(provider.id);
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Provider header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              isConfigured ? "bg-green-500" : "bg-zinc-500",
            )}
          />
          <div className="text-left">
            <div className="text-sm font-medium">{provider.name}</div>
            <div className="text-[10px] text-muted-foreground">
              {provider.id}
              {provider.apiKeySet && provider.apiKey && (
                <span className="ml-2 font-mono">{provider.apiKey}</span>
              )}
              {provider.baseUrl && (
                <span className="ml-2">{provider.baseUrl}</span>
              )}
            </div>
          </div>
        </div>
        <span className="text-muted-foreground text-xs">
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {/* Expanded form */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-border space-y-3">
          {/* API Key */}
          {provider.needsApiKey && (
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
                    ? `Current: ${provider.apiKey}`
                    : "Enter API key..."
                }
                className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
              />
            </div>
          )}

          {/* Base URL */}
          {provider.needsBaseUrl && (
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
              {testResult?.testing ? "Testing..." : "Test Connection"}
            </button>

            {/* Test result indicator */}
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
