import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import {
  useSettingsStore,
  type TTSProviderConfig,
} from "../../stores/settings-store";

export function SpeechTab() {
  const ttsProviders = useSettingsStore((s) => s.ttsProviders);
  const activeTTSProvider = useSettingsStore((s) => s.activeTTSProvider);
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const ttsVoice = useSettingsStore((s) => s.ttsVoice);
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);
  const loadTTSSettings = useSettingsStore((s) => s.loadTTSSettings);
  const setTTSEnabled = useSettingsStore((s) => s.setTTSEnabled);
  const setTTSVoiceFn = useSettingsStore((s) => s.setTTSVoice);
  const setTTSSpeedFn = useSettingsStore((s) => s.setTTSSpeed);

  useEffect(() => {
    loadTTSSettings();
  }, []);

  return (
    <div className="p-5 space-y-4">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Text-to-Speech</p>
          <p className="text-xs text-muted-foreground">
            Have your assistant speak its responses aloud.
          </p>
        </div>
        <button
          onClick={() => setTTSEnabled(!ttsEnabled)}
          className={cn(
            "relative w-9 h-5 rounded-full transition-colors",
            ttsEnabled ? "bg-primary" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
              ttsEnabled ? "translate-x-4" : "translate-x-0.5",
            )}
          />
        </button>
      </div>

      {/* Voice selector */}
      {ttsEnabled && activeTTSProvider && (
        <>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 block">
              Voice
            </label>
            <div className="flex flex-wrap gap-1.5">
              {(
                ttsProviders.find((p) => p.id === activeTTSProvider)?.voices ??
                []
              ).map((v) => (
                <button
                  key={v}
                  onClick={() => setTTSVoiceFn(v)}
                  className={cn(
                    "px-2.5 py-1 rounded-md border text-xs transition-colors",
                    ttsVoice === v
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Speed slider */}
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 block">
              Speed: {ttsSpeed.toFixed(1)}x
            </label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={ttsSpeed}
              onChange={(e) => setTTSSpeedFn(parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0.5x</span>
              <span>1.0x</span>
              <span>2.0x</span>
            </div>
          </div>
        </>
      )}

      {/* Provider cards */}
      <div className="space-y-3">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Providers
        </p>
        {ttsProviders.map((provider) => (
          <TTSProviderCard
            key={provider.id}
            provider={provider}
            isActive={provider.id === activeTTSProvider}
          />
        ))}
      </div>
    </div>
  );
}

function TTSProviderCard({
  provider,
  isActive,
}: {
  provider: TTSProviderConfig;
  isActive: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [saving, setSaving] = useState(false);

  const updateTTSProvider = useSettingsStore((s) => s.updateTTSProvider);
  const setActiveTTSProvider = useSettingsStore((s) => s.setActiveTTSProvider);
  const testTTSProviderFn = useSettingsStore((s) => s.testTTSProvider);
  const testResult = useSettingsStore((s) => s.ttsTestResults[provider.id]);

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
    await updateTTSProvider(provider.id, data);
    setApiKey("");
    setSaving(false);
  };

  const handleTest = () => {
    testTTSProviderFn(provider.id);
  };

  const handleActivate = () => {
    setActiveTTSProvider(isActive ? null : provider.id);
  };

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
              name="active-tts-provider"
              checked={isActive}
              onChange={handleActivate}
              className="accent-primary"
            />
            <span className="text-xs">Use as active TTS provider</span>
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
                placeholder="https://..."
                className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
              />
            </div>
          )}

          {/* No config needed note */}
          {!provider.needsApiKey && !provider.needsBaseUrl && (
            <p className="text-xs text-muted-foreground">
              No configuration needed. Model downloads automatically on first
              use (~100MB).
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            {(provider.needsApiKey || provider.needsBaseUrl) && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            )}
            <button
              onClick={handleTest}
              disabled={testResult?.testing}
              className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80 disabled:opacity-50"
            >
              {testResult?.testing ? "Testing..." : "Test"}
            </button>

            {testResult && !testResult.testing && (
              <span
                className={cn(
                  "text-xs",
                  testResult.ok ? "text-green-500" : "text-red-500",
                )}
              >
                {testResult.ok
                  ? "\u2713 OK"
                  : `\u2717 ${testResult.error ?? "Failed"}`}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
