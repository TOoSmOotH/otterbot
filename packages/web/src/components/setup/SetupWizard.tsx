import { useState, useEffect, useRef, useCallback } from "react";
import { useAuthStore } from "../../stores/auth-store";

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

  const handleComplete = async () => {
    if (passphrase.length < 8) {
      setError("Passphrase must be at least 8 characters");
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setError("Passphrases do not match");
      return;
    }

    setSubmitting(true);
    await completeSetup({
      passphrase,
      provider,
      model,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
    });
    setSubmitting(false);
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
                    if (e.key === "Enter") handleComplete();
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
                  onClick={handleComplete}
                  disabled={
                    !passphrase || !confirmPassphrase || submitting
                  }
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? "Setting up..." : "Complete Setup"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
