import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import {
  useSettingsStore,
  type SearchProviderConfig,
} from "../../stores/settings-store";

export function SearchTab() {
  const searchProviders = useSettingsStore((s) => s.searchProviders);
  const activeSearchProvider = useSettingsStore((s) => s.activeSearchProvider);
  const loadSearchSettings = useSettingsStore((s) => s.loadSearchSettings);

  useEffect(() => {
    loadSearchSettings();
  }, []);

  return (
    <div className="p-5 space-y-3">
      <p className="text-xs text-muted-foreground mb-4">
        Configure a web search provider for agent research capabilities. Select
        one provider as active.
      </p>
      {searchProviders.map((provider) => (
        <SearchProviderCard
          key={provider.id}
          provider={provider}
          isActive={provider.id === activeSearchProvider}
        />
      ))}
    </div>
  );
}

function SearchProviderCard({
  provider,
  isActive,
}: {
  provider: SearchProviderConfig;
  isActive: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [saving, setSaving] = useState(false);

  const updateSearchProvider = useSettingsStore((s) => s.updateSearchProvider);
  const setActiveSearchProvider = useSettingsStore(
    (s) => s.setActiveSearchProvider,
  );
  const testSearchProviderFn = useSettingsStore((s) => s.testSearchProvider);
  const testResult = useSettingsStore(
    (s) => s.searchTestResults[provider.id],
  );

  const isConfigured =
    (provider.apiKeySet || !provider.needsApiKey) &&
    (!!provider.baseUrl || !provider.needsBaseUrl);

  const handleSave = async () => {
    setSaving(true);
    const data: { apiKey?: string; baseUrl?: string } = {};
    if (provider.needsApiKey && apiKey) {
      data.apiKey = apiKey;
    }
    if (provider.needsBaseUrl) {
      data.baseUrl = baseUrl;
    }
    await updateSearchProvider(provider.id, data);
    setApiKey("");
    setSaving(false);
  };

  const handleTest = () => {
    testSearchProviderFn(provider.id);
  };

  const handleActivate = () => {
    setActiveSearchProvider(isActive ? null : provider.id);
  };

  const placeholder =
    provider.id === "searxng" ? "http://searxng:8080" : "https://...";

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              isActive
                ? "bg-green-500"
                : isConfigured
                  ? "bg-yellow-500"
                  : "bg-zinc-500",
            )}
          />
          <div className="text-left">
            <div className="text-sm font-medium">
              {provider.name}
              {isActive && (
                <span className="ml-2 text-[10px] text-green-500 font-normal">
                  Active
                </span>
              )}
            </div>
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
          {/* Active toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="active-search-provider"
              checked={isActive}
              onChange={handleActivate}
              className="accent-primary"
            />
            <span className="text-xs">Use as active search provider</span>
          </label>

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
                placeholder={placeholder}
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
