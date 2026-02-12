import { useState, useEffect, useRef, useCallback } from "react";
import { useAuthStore } from "../../stores/auth-store";
import { DEFAULT_AVATARS } from "./default-avatars";

const SUGGESTED_MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-5-20250929", "claude-haiku-4-20250414"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  ollama: ["llama3.1", "mistral", "codellama"],
  "openai-compatible": [],
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  anthropic: "Claude models from Anthropic. Requires an API key.",
  openai: "GPT models from OpenAI. Requires an API key.",
  ollama: "Run local models with Ollama. Requires a base URL.",
  "openai-compatible":
    "Any OpenAI-compatible API endpoint. Requires a base URL and optionally an API key.",
};

const NEEDS_API_KEY = new Set(["anthropic", "openai", "openai-compatible"]);
const NEEDS_BASE_URL = new Set(["ollama", "openai-compatible"]);

const IANA_TIMEZONES = Intl.supportedValuesOf("timeZone");

function resizeImage(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = maxSize;
      canvas.height = maxSize;
      const ctx = canvas.getContext("2d")!;

      // Cover-crop: scale and center
      const scale = Math.max(maxSize / img.width, maxSize / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (maxSize - w) / 2, (maxSize - h) / 2, w, h);

      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

export function SetupWizard() {
  const { providers, completeSetup, error, setError } = useAuthStore();

  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const probeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 3: Profile
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [draggingOver, setDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 4: Voice
  const [ttsVoice, setTtsVoice] = useState<string | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState(false);

  const probeModels = useCallback(async (prov: string, key: string, url: string) => {
    const needsKey = NEEDS_API_KEY.has(prov);
    const needsUrl = NEEDS_BASE_URL.has(prov);

    // Don't probe if required credentials are missing
    if (needsKey && !key) return;
    if (needsUrl && !url) return;

    setFetchingModels(true);
    try {
      const res = await fetch("/api/setup/probe-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: prov, apiKey: key || undefined, baseUrl: url || undefined }),
      });
      if (res.ok) {
        const data = (await res.json()) as { models: string[] };
        setFetchedModels(data.models);
        // Auto-select first fetched model if no model is currently set
        if (data.models.length > 0) {
          setModel((prev) => prev || data.models[0]);
        }
      }
    } catch {
      // Silently fail — hardcoded suggestions remain
    } finally {
      setFetchingModels(false);
    }
  }, []);

  // Debounced model probing when credentials change
  useEffect(() => {
    if (!provider) return;

    if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
    probeTimerRef.current = setTimeout(() => {
      probeModels(provider, apiKey, baseUrl);
    }, 600);

    return () => {
      if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
    };
  }, [provider, apiKey, baseUrl, probeModels]);

  const handleSelectProvider = (id: string) => {
    setProvider(id);
    setFetchedModels([]);
    // Set default model from suggestions
    const suggestions = SUGGESTED_MODELS[id];
    if (suggestions && suggestions.length > 0) {
      setModel(suggestions[0]);
    } else {
      setModel("");
    }
    // Set default base URL for ollama
    if (id === "ollama" && !baseUrl) {
      setBaseUrl("http://localhost:11434/api");
    }
    setError(null);
  };

  const handleNext = () => {
    if (!provider) {
      setError("Please select a provider");
      return;
    }
    if (!model) {
      setError("Please enter a model name");
      return;
    }
    if (NEEDS_API_KEY.has(provider) && !apiKey) {
      setError("An API key is required for this provider");
      return;
    }
    if (NEEDS_BASE_URL.has(provider) && !baseUrl) {
      setError("A base URL is required for this provider");
      return;
    }
    setError(null);
    setStep(2);
  };

  const handleNextToProfile = () => {
    if (passphrase.length < 8) {
      setError("Passphrase must be at least 8 characters");
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setError("Passphrases do not match");
      return;
    }
    setError(null);
    setStep(3);
  };

  const handleAvatarChange = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file");
      return;
    }
    try {
      const dataUrl = await resizeImage(file, 256);
      setAvatar(dataUrl);
      setError(null);
    } catch {
      setError("Failed to process image");
    }
  };

  const handleNextToVoice = () => {
    if (!displayName.trim()) {
      setError("Display name is required");
      return;
    }
    if (!timezone) {
      setError("Timezone is required");
      return;
    }
    setError(null);
    setStep(4);
  };

  const handleComplete = async () => {
    setSubmitting(true);
    await completeSetup({
      passphrase,
      provider,
      model,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
      userName: displayName.trim(),
      userAvatar: avatar || undefined,
      userBio: bio.trim() || undefined,
      userTimezone: timezone,
      ttsVoice: ttsVoice || undefined,
    });
    setSubmitting(false);
  };

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const handlePreviewVoice = async (voice: string) => {
    // Stop any currently playing preview
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }

    setTtsVoice(voice);
    setPreviewingVoice(true);
    setError(null);

    try {
      const res = await fetch("/api/setup/tts-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Preview failed");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.addEventListener("ended", () => {
        URL.revokeObjectURL(url);
        previewAudioRef.current = null;
      });
      await audio.play();
    } catch {
      setError("Failed to preview voice");
    } finally {
      setPreviewingVoice(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-lg mx-4">
        <div className="bg-card border border-border rounded-lg p-8">
          {/* Branding */}
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <span className="text-primary text-sm font-bold">S</span>
            </div>
            <h1 className="text-lg font-semibold tracking-tight">Smoothbot</h1>
          </div>
          <p className="text-center text-sm text-muted-foreground mb-6">
            Initial Setup
          </p>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <div
              className={`w-2 h-2 rounded-full ${step >= 1 ? "bg-primary" : "bg-muted"}`}
            />
            <div
              className={`w-8 h-px ${step >= 2 ? "bg-primary" : "bg-muted"}`}
            />
            <div
              className={`w-2 h-2 rounded-full ${step >= 2 ? "bg-primary" : "bg-muted"}`}
            />
            <div
              className={`w-8 h-px ${step >= 3 ? "bg-primary" : "bg-muted"}`}
            />
            <div
              className={`w-2 h-2 rounded-full ${step >= 3 ? "bg-primary" : "bg-muted"}`}
            />
            <div
              className={`w-8 h-px ${step >= 4 ? "bg-primary" : "bg-muted"}`}
            />
            <div
              className={`w-2 h-2 rounded-full ${step >= 4 ? "bg-primary" : "bg-muted"}`}
            />
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium">
                1. Configure your LLM provider
              </h2>

              {/* Provider cards */}
              <div className="grid grid-cols-2 gap-2">
                {providers.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectProvider(p.id)}
                    className={`p-3 rounded-md border text-left text-sm transition-colors ${
                      provider === p.id
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-muted-foreground"
                    }`}
                  >
                    <div className="font-medium">{p.name}</div>
                  </button>
                ))}
              </div>

              {provider && (
                <p className="text-xs text-muted-foreground">
                  {PROVIDER_DESCRIPTIONS[provider]}
                </p>
              )}

              {/* API Key */}
              {provider && NEEDS_API_KEY.has(provider) && (
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}

              {/* Base URL */}
              {provider && NEEDS_BASE_URL.has(provider) && (
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="http://localhost:11434/api"
                    className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}

              {/* Model */}
              {provider && (
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">
                    Model
                  </label>
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Model name"
                    className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {(() => {
                    const suggested = SUGGESTED_MODELS[provider] ?? [];
                    const merged = [...new Set([...suggested, ...fetchedModels])];
                    return merged.length > 0 || fetchingModels ? (
                      <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
                        {merged.map((m) => (
                          <button
                            key={m}
                            onClick={() => setModel(m)}
                            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                              model === m
                                ? "border-primary text-primary"
                                : "border-border text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                        {fetchingModels && (
                          <span className="text-xs text-muted-foreground">
                            Loading models...
                          </span>
                        )}
                      </div>
                    ) : null;
                  })()}
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <button
                onClick={handleNext}
                disabled={!provider || !model}
                className="w-full px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium">
                2. Set a passphrase to protect the UI
              </h2>
              <p className="text-xs text-muted-foreground">
                You will need this passphrase to access Smoothbot. Minimum 8
                characters.
              </p>

              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">
                  Passphrase
                </label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter a passphrase"
                  autoFocus
                  className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">
                  Confirm Passphrase
                </label>
                <input
                  type="password"
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleNextToProfile();
                  }}
                  placeholder="Confirm your passphrase"
                  className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStep(1);
                    setError(null);
                  }}
                  className="px-4 py-2 bg-secondary text-secondary-foreground text-sm font-medium rounded-md hover:bg-secondary/80 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleNextToProfile}
                  disabled={!passphrase || !confirmPassphrase}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium">
                3. Tell the team about yourself
              </h2>
              <p className="text-xs text-muted-foreground">
                Your AI agents will use this to personalize their interactions
                with you.
              </p>

              {/* Avatar upload */}
              <div className="flex justify-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleAvatarChange(file);
                  }}
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDraggingOver(true);
                  }}
                  onDragLeave={() => setDraggingOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDraggingOver(false);
                    const file = e.dataTransfer.files[0];
                    if (file) handleAvatarChange(file);
                  }}
                  className={`relative w-20 h-20 rounded-full border-2 border-dashed flex items-center justify-center cursor-pointer transition-colors ${
                    draggingOver
                      ? "border-primary bg-primary/10"
                      : avatar
                        ? "border-transparent"
                        : "border-border hover:border-muted-foreground"
                  }`}
                >
                  {avatar ? (
                    <img
                      src={avatar}
                      alt="Avatar preview"
                      className="w-20 h-20 rounded-full object-cover"
                    />
                  ) : (
                    <span className="text-muted-foreground text-xs text-center leading-tight">
                      Photo
                    </span>
                  )}
                </div>
              </div>
              {avatar && (
                <div className="flex justify-center">
                  <button
                    onClick={() => setAvatar(null)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Remove photo
                  </button>
                </div>
              )}

              {/* Default avatar picker */}
              {!avatar && (
                <div>
                  <p className="text-xs text-muted-foreground text-center mb-2">
                    Or pick one
                  </p>
                  <div className="flex justify-center gap-2 flex-wrap">
                    {DEFAULT_AVATARS.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => setAvatar(a.url)}
                        title={a.label}
                        className="w-9 h-9 rounded-full overflow-hidden border-2 border-transparent hover:border-primary transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <img
                          src={a.url}
                          alt={a.label}
                          className="w-full h-full"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Display name */}
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">
                  Display Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How should your agents address you?"
                  autoFocus
                  className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Bio */}
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">
                  Short Bio
                </label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="A sentence or two for agent context (optional)"
                  rows={2}
                  className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>

              {/* Timezone */}
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">
                  Timezone <span className="text-destructive">*</span>
                </label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {IANA_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStep(2);
                    setError(null);
                  }}
                  className="px-4 py-2 bg-secondary text-secondary-foreground text-sm font-medium rounded-md hover:bg-secondary/80 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleNextToVoice}
                  disabled={!displayName.trim() || !timezone}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium">
                4. Choose a voice for your assistant
              </h2>
              <p className="text-xs text-muted-foreground">
                Your assistant can speak its responses aloud. Pick a voice, or
                skip to use text only.
              </p>

              {/* Voice grid */}
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                  Female voices
                </p>
                <div className="grid grid-cols-3 gap-1.5 mb-3">
                  {[
                    "af_heart",
                    "af_bella",
                    "af_nicole",
                    "af_aoede",
                    "af_kore",
                    "af_sarah",
                    "af_sky",
                  ].map((v) => (
                    <button
                      key={v}
                      onClick={() => handlePreviewVoice(v)}
                      disabled={previewingVoice}
                      className={`relative px-2 py-1.5 rounded-md border text-xs transition-colors ${
                        previewingVoice && ttsVoice !== v
                          ? "opacity-40 cursor-not-allowed"
                          : ""
                      } ${
                        ttsVoice === v
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span className={previewingVoice && ttsVoice === v ? "opacity-0" : ""}>
                        {v.replace("af_", "")}
                      </span>
                      {previewingVoice && ttsVoice === v && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <svg className="animate-spin h-3.5 w-3.5 text-primary" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                  Male voices
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    "am_adam",
                    "am_michael",
                    "am_echo",
                    "am_eric",
                    "am_liam",
                    "am_onyx",
                  ].map((v) => (
                    <button
                      key={v}
                      onClick={() => handlePreviewVoice(v)}
                      disabled={previewingVoice}
                      className={`relative px-2 py-1.5 rounded-md border text-xs transition-colors ${
                        previewingVoice && ttsVoice !== v
                          ? "opacity-40 cursor-not-allowed"
                          : ""
                      } ${
                        ttsVoice === v
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span className={previewingVoice && ttsVoice === v ? "opacity-0" : ""}>
                        {v.replace("am_", "")}
                      </span>
                      {previewingVoice && ttsVoice === v && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <svg className="animate-spin h-3.5 w-3.5 text-primary" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Loading status bar */}
              {previewingVoice && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary rounded-md px-3 py-2">
                  <svg className="animate-spin h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>
                    Generating preview... First time may take 30–60s while the voice model downloads.
                  </span>
                </div>
              )}

              {!previewingVoice && (
                <p className="text-[10px] text-muted-foreground">
                  Click a voice to hear a preview. More voices (British,
                  Japanese, Spanish, and others) are available in Settings
                  after setup.
                </p>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStep(3);
                    setError(null);
                  }}
                  className="px-4 py-2 bg-secondary text-secondary-foreground text-sm font-medium rounded-md hover:bg-secondary/80 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleComplete}
                  disabled={submitting}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting
                    ? "Setting up..."
                    : ttsVoice
                      ? "Complete Setup"
                      : "Complete Setup"}
                </button>
              </div>

              <button
                onClick={() => {
                  setTtsVoice(null);
                  handleComplete();
                }}
                disabled={submitting}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip — text only
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
