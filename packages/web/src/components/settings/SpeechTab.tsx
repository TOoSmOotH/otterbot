import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "../../lib/utils";
import {
  useSettingsStore,
  type TTSProviderConfig,
  type STTProviderConfig,
} from "../../stores/settings-store";

const WHISPER_MODELS = [
  { id: "onnx-community/whisper-tiny.en", label: "tiny.en (~75MB, English only)" },
  { id: "onnx-community/whisper-base", label: "base (~150MB, multilingual)" },
  { id: "onnx-community/whisper-base.en", label: "base.en (~150MB, English only)" },
  { id: "onnx-community/whisper-small", label: "small (~500MB, multilingual)" },
  { id: "onnx-community/whisper-small.en", label: "small.en (~500MB, English only)" },
];

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

  const sttEnabled = useSettingsStore((s) => s.sttEnabled);
  const sttProviders = useSettingsStore((s) => s.sttProviders);
  const activeSTTProvider = useSettingsStore((s) => s.activeSTTProvider);
  const sttLanguage = useSettingsStore((s) => s.sttLanguage);
  const sttModelId = useSettingsStore((s) => s.sttModelId);
  const loadSTTSettings = useSettingsStore((s) => s.loadSTTSettings);
  const setSTTEnabled = useSettingsStore((s) => s.setSTTEnabled);
  const setSTTLanguageFn = useSettingsStore((s) => s.setSTTLanguage);
  const setSTTModelFn = useSettingsStore((s) => s.setSTTModel);

  useEffect(() => {
    loadTTSSettings();
    loadSTTSettings();
  }, []);

  return (
    <div className="p-5 space-y-6">
      {/* ================================================================= */}
      {/* Speech-to-Text */}
      {/* ================================================================= */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Speech-to-Text</p>
            <p className="text-xs text-muted-foreground">
              Transcribe your voice to text using a local Whisper model or cloud
              API.
            </p>
          </div>
          <button
            onClick={() => setSTTEnabled(!sttEnabled)}
            className={cn(
              "relative w-9 h-5 rounded-full transition-colors",
              sttEnabled ? "bg-primary" : "bg-muted",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                sttEnabled ? "translate-x-4" : "translate-x-0.5",
              )}
            />
          </button>
        </div>

        {sttEnabled && (
          <>
            {/* Model selector (for whisper-local) */}
            {activeSTTProvider === "whisper-local" && (
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                  Whisper Model
                </label>
                <select
                  value={sttModelId}
                  onChange={(e) => setSTTModelFn(e.target.value)}
                  className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                >
                  {WHISPER_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Language */}
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                Language (optional)
              </label>
              <input
                type="text"
                value={sttLanguage}
                onChange={(e) => setSTTLanguageFn(e.target.value)}
                placeholder="auto-detect (or e.g. en, fr, de, ja)"
                className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
              />
            </div>

            {/* Provider cards */}
            <div className="space-y-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Providers
              </p>
              {sttProviders.map((provider) => (
                <STTProviderCard
                  key={provider.id}
                  provider={provider}
                  isActive={provider.id === activeSTTProvider}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="border-t border-border" />

      {/* ================================================================= */}
      {/* Text-to-Speech */}
      {/* ================================================================= */}
      <div className="space-y-4">
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
            <VoiceSelector
              voices={
                ttsProviders.find((p) => p.id === activeTTSProvider)?.voices ??
                []
              }
              activeVoice={ttsVoice}
              onSelect={setTTSVoiceFn}
              provider={activeTTSProvider}
            />

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
        {ttsEnabled && (
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
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// STT Provider Card
// ---------------------------------------------------------------------------

function STTProviderCard({
  provider,
  isActive,
}: {
  provider: STTProviderConfig;
  isActive: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [saving, setSaving] = useState(false);

  const updateSTTProvider = useSettingsStore((s) => s.updateSTTProvider);
  const setActiveSTTProvider = useSettingsStore((s) => s.setActiveSTTProvider);
  const testSTTProviderFn = useSettingsStore((s) => s.testSTTProvider);
  const testResult = useSettingsStore((s) => s.sttTestResults[provider.id]);

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
    await updateSTTProvider(provider.id, data);
    setApiKey("");
    setSaving(false);
  };

  const handleTest = () => {
    testSTTProviderFn(provider.id);
  };

  const handleActivate = () => {
    setActiveSTTProvider(isActive ? null : provider.id);
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

      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-border space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="active-stt-provider"
              checked={isActive}
              onChange={handleActivate}
              className="accent-primary"
            />
            <span className="text-xs">Use as active STT provider</span>
          </label>

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

          {!provider.needsApiKey && !provider.needsBaseUrl && (
            <p className="text-xs text-muted-foreground">
              No configuration needed. Model downloads automatically on first
              use.
            </p>
          )}

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

// ---------------------------------------------------------------------------
// Voice language groups for Kokoro (prefix -> label)
// ---------------------------------------------------------------------------

const KOKORO_VOICE_GROUPS: { prefix: string; label: string }[] = [
  { prefix: "af_", label: "American English (Female)" },
  { prefix: "am_", label: "American English (Male)" },
  { prefix: "bf_", label: "British English (Female)" },
  { prefix: "bm_", label: "British English (Male)" },
  { prefix: "jf_", label: "Japanese (Female)" },
  { prefix: "jm_", label: "Japanese (Male)" },
  { prefix: "zf_", label: "Mandarin Chinese (Female)" },
  { prefix: "zm_", label: "Mandarin Chinese (Male)" },
  { prefix: "ef_", label: "Spanish (Female)" },
  { prefix: "em_", label: "Spanish (Male)" },
  { prefix: "ff_", label: "French (Female)" },
  { prefix: "hf_", label: "Hindi (Female)" },
  { prefix: "hm_", label: "Hindi (Male)" },
  { prefix: "if_", label: "Italian (Female)" },
  { prefix: "im_", label: "Italian (Male)" },
  { prefix: "pf_", label: "Portuguese (Female)" },
  { prefix: "pm_", label: "Portuguese (Male)" },
];

function VoiceSelector({
  voices,
  activeVoice,
  onSelect,
  provider,
}: {
  voices: string[];
  activeVoice: string;
  onSelect: (voice: string) => void;
  provider: string;
}) {
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSelect = useCallback(
    async (voice: string) => {
      // Stop any currently playing preview
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      onSelect(voice);
      setPreviewing(voice);

      try {
        const res = await fetch("/api/settings/tts/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voice }),
        });

        if (!res.ok) {
          setPreviewing(null);
          return;
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.addEventListener("ended", () => {
          URL.revokeObjectURL(url);
          audioRef.current = null;
          setPreviewing(null);
        });
        await audio.play();
      } catch {
        setPreviewing(null);
      }
    },
    [onSelect],
  );

  const renderButton = (v: string, label: string) => {
    const isActive = activeVoice === v;
    const isLoading = previewing === v;
    const isDisabled = previewing !== null && previewing !== v;

    return (
      <button
        key={v}
        onClick={() => handleSelect(v)}
        disabled={isDisabled}
        className={cn(
          "relative px-2.5 py-1 rounded-md border text-xs transition-colors",
          isDisabled && "opacity-40 cursor-not-allowed",
          isActive
            ? "border-primary bg-primary/10 text-foreground"
            : "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground",
        )}
      >
        <span className={isLoading ? "opacity-0" : ""}>{label}</span>
        {isLoading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <svg
              className="animate-spin h-3 w-3 text-primary"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          </span>
        )}
      </button>
    );
  };

  if (provider !== "kokoro") {
    return (
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 block">
          Voice
        </label>
        <div className="flex flex-wrap gap-1.5">
          {voices.map((v) => renderButton(v, v))}
        </div>
        {previewing && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
            <svg
              className="animate-spin h-3 w-3 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span>Generating preview...</span>
          </div>
        )}
      </div>
    );
  }

  // Group Kokoro voices by prefix
  const groups = KOKORO_VOICE_GROUPS.map((g) => ({
    ...g,
    voices: voices.filter((v) => v.startsWith(g.prefix)),
  })).filter((g) => g.voices.length > 0);

  return (
    <div className="space-y-3">
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider block">
        Voice
      </label>
      {groups.map((group) => (
        <div key={group.prefix}>
          <p className="text-[10px] text-muted-foreground mb-1.5">
            {group.label}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {group.voices.map((v) =>
              renderButton(v, v.slice(group.prefix.length)),
            )}
          </div>
        </div>
      ))}
      {previewing && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary rounded-md px-3 py-2">
          <svg
            className="animate-spin h-3.5 w-3.5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span>Generating preview...</span>
        </div>
      )}
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
