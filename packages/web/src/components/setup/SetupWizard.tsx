import { useState, useEffect, useRef, useCallback } from "react";
import { useAuthStore } from "../../stores/auth-store";
import { useModelPackStore } from "../../stores/model-pack-store";
import { CharacterSelect } from "../character-select/CharacterSelect";
import { DEFAULT_AVATARS } from "./default-avatars";
import type { GearConfig } from "@otterbot/shared";
import { ModelPricingPrompt } from "../settings/ModelPricingPrompt";
import { saveWizardState, loadWizardState, clearWizardState } from "../../hooks/use-setup-persistence";

const SUGGESTED_MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-5-20250929", "claude-haiku-4-20250414"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  ollama: ["llama3.1", "mistral", "codellama"],
  openrouter: [],
  "openai-compatible": [],
};

const CODING_SUGGESTED_MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-5-20250929", "claude-opus-4-20250514"],
  openai: ["gpt-4.1", "gpt-4o", "o3-mini"],
  ollama: ["qwen2.5-coder", "codellama", "deepseek-coder-v2"],
  openrouter: [
    "anthropic/claude-sonnet-4-5-20250929",
    "openai/gpt-4.1",
    "deepseek/deepseek-coder",
  ],
  "openai-compatible": [],
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  anthropic: "Claude models from Anthropic. Requires an API key.",
  openai: "GPT models from OpenAI. Requires an API key.",
  ollama: "Run local models with Ollama. Requires a base URL.",
  openrouter: "Access 200+ models through one API. Requires an OpenRouter API key.",
  "openai-compatible":
    "Any OpenAI-compatible API endpoint. Requires a base URL and optionally an API key.",
};

const NEEDS_API_KEY = new Set(["anthropic", "openai", "openrouter", "openai-compatible"]);
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

function VoiceButton({
  voice,
  label,
  ttsVoice,
  previewingVoice,
  onPreview,
}: {
  voice: string;
  label: string;
  ttsVoice: string | null;
  previewingVoice: boolean;
  onPreview: (voice: string) => void;
}) {
  const isActive = ttsVoice === voice;
  const isLoading = previewingVoice && isActive;
  const isDisabled = previewingVoice && !isActive;

  return (
    <button
      onClick={() => onPreview(voice)}
      disabled={isDisabled}
      className={`relative px-2 py-1.5 rounded-md border text-xs transition-colors ${
        isDisabled ? "opacity-40 cursor-not-allowed" : ""
      } ${
        isActive
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground"
      }`}
    >
      <span className={isLoading ? "opacity-0" : ""}>{label}</span>
      {isLoading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <svg className="animate-spin h-3.5 w-3.5 text-primary" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </span>
      )}
    </button>
  );
}

export function SetupWizard() {
  const { providerTypes, setSetupPassphrase, completeSetup, error, setError } = useAuthStore();

  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState("");
  const [providerName, setProviderName] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const probeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const modelComboRef = useRef<HTMLDivElement>(null);

  // Step 3: Profile
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [draggingOver, setDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 4: User Character (moved before COO)
  const [characterPackId, setCharacterPackId] = useState<string | null>(null);
  const [characterGearConfig, setCharacterGearConfig] = useState<GearConfig | null>(null);

  // Step 5: COO customization
  const [cooName, setCooName] = useState("");
  const [cooModelPackId, setCooModelPackId] = useState<string | null>(null);
  const [cooGearConfig, setCooGearConfig] = useState<GearConfig | null>(null);

  // Step 6: Admin Assistant customization
  const [adminName, setAdminName] = useState("");
  const [adminModelPackId, setAdminModelPackId] = useState<string | null>(null);
  const [adminGearConfig, setAdminGearConfig] = useState<GearConfig | null>(null);
  const modelPacks = useModelPackStore((s) => s.packs);
  const modelPacksLoading = useModelPackStore((s) => s.loading);
  const loadPacks = useModelPackStore((s) => s.loadPacks);

  // Pre-fetch model packs on mount so they're ready by step 4/5
  // Step 6: Web Search
  const [searchProvider, setSearchProvider] = useState<string>("duckduckgo");
  const [searchApiKey, setSearchApiKey] = useState("");
  const [searchBaseUrl, setSearchBaseUrl] = useState("");
  useEffect(() => {
    loadPacks();
  }, [loadPacks]);

  // Step 7: Voice
  const [ttsProvider, setTtsProvider] = useState<string | null>(null);
  const [ttsVoice, setTtsVoice] = useState<string | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  // OpenAI-compatible TTS fields (shown when that provider is selected)
  const [ttsApiKey, setTtsApiKey] = useState("");
  const [ttsBaseUrl, setTtsBaseUrl] = useState("");

  // Step 8: OpenCode coding agent
  const [openCodeEnabled, setOpenCodeEnabled] = useState(true);
  const [openCodeInteractive, setOpenCodeInteractive] = useState(false);
  const [openCodeUseSameProvider, setOpenCodeUseSameProvider] = useState(true);
  const [openCodeProvider, setOpenCodeProvider] = useState("");
  const [openCodeModel, setOpenCodeModel] = useState("");
  const [openCodeApiKey, setOpenCodeApiKey] = useState("");
  const [openCodeBaseUrl, setOpenCodeBaseUrl] = useState("");
  const [openCodeFetchedModels, setOpenCodeFetchedModels] = useState<string[]>([]);
  const [openCodeFetchingModels, setOpenCodeFetchingModels] = useState(false);
  const openCodeProbeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openCodeModelDropdownOpen, setOpenCodeModelDropdownOpen] = useState(false);
  const [openCodeModelFilter, setOpenCodeModelFilter] = useState("");
  const openCodeModelComboRef = useRef<HTMLDivElement>(null);

  // Restore wizard state from sessionStorage on mount
  useEffect(() => {
    const saved = loadWizardState();
    if (!saved) return;
    if (typeof saved.step === "number") setStep(saved.step);
    if (typeof saved.provider === "string") setProvider(saved.provider);
    if (typeof saved.providerName === "string") setProviderName(saved.providerName);
    if (typeof saved.model === "string") setModel(saved.model);
    if (typeof saved.apiKey === "string") setApiKey(saved.apiKey);
    if (typeof saved.baseUrl === "string") setBaseUrl(saved.baseUrl);
    if (typeof saved.displayName === "string") setDisplayName(saved.displayName);
    if (typeof saved.avatar === "string") setAvatar(saved.avatar);
    if (typeof saved.bio === "string") setBio(saved.bio);
    if (typeof saved.timezone === "string") setTimezone(saved.timezone);
    if (typeof saved.characterPackId === "string") setCharacterPackId(saved.characterPackId);
    if (saved.characterGearConfig != null) setCharacterGearConfig(saved.characterGearConfig as GearConfig);
    if (typeof saved.cooName === "string") setCooName(saved.cooName);
    if (typeof saved.cooModelPackId === "string") setCooModelPackId(saved.cooModelPackId);
    if (saved.cooGearConfig != null) setCooGearConfig(saved.cooGearConfig as GearConfig);
    if (typeof saved.adminName === "string") setAdminName(saved.adminName);
    if (typeof saved.adminModelPackId === "string") setAdminModelPackId(saved.adminModelPackId);
    if (saved.adminGearConfig != null) setAdminGearConfig(saved.adminGearConfig as GearConfig);
    if (typeof saved.searchProvider === "string") setSearchProvider(saved.searchProvider);
    if (typeof saved.searchApiKey === "string") setSearchApiKey(saved.searchApiKey);
    if (typeof saved.searchBaseUrl === "string") setSearchBaseUrl(saved.searchBaseUrl);
    if (typeof saved.ttsProvider === "string") setTtsProvider(saved.ttsProvider);
    if (typeof saved.ttsVoice === "string") setTtsVoice(saved.ttsVoice);
    if (typeof saved.ttsApiKey === "string") setTtsApiKey(saved.ttsApiKey);
    if (typeof saved.ttsBaseUrl === "string") setTtsBaseUrl(saved.ttsBaseUrl);
    if (typeof saved.openCodeEnabled === "boolean") setOpenCodeEnabled(saved.openCodeEnabled);
    if (typeof saved.openCodeInteractive === "boolean") setOpenCodeInteractive(saved.openCodeInteractive);
    if (typeof saved.openCodeUseSameProvider === "boolean") setOpenCodeUseSameProvider(saved.openCodeUseSameProvider);
    if (typeof saved.openCodeProvider === "string") setOpenCodeProvider(saved.openCodeProvider);
    if (typeof saved.openCodeModel === "string") setOpenCodeModel(saved.openCodeModel);
    if (typeof saved.openCodeApiKey === "string") setOpenCodeApiKey(saved.openCodeApiKey);
    if (typeof saved.openCodeBaseUrl === "string") setOpenCodeBaseUrl(saved.openCodeBaseUrl);
  }, []);

  // Persist wizard state to sessionStorage on change
  useEffect(() => {
    saveWizardState({
      step, provider, providerName, model, apiKey, baseUrl,
      displayName, avatar, bio, timezone,
      characterPackId, characterGearConfig,
      cooName, cooModelPackId, cooGearConfig,
      adminName, adminModelPackId, adminGearConfig,
      searchProvider, searchApiKey, searchBaseUrl,
      ttsProvider, ttsVoice, ttsApiKey, ttsBaseUrl,
      openCodeEnabled, openCodeInteractive, openCodeUseSameProvider,
      openCodeProvider, openCodeModel, openCodeApiKey, openCodeBaseUrl,
    });
  }, [
    step, provider, providerName, model, apiKey, baseUrl,
    displayName, avatar, bio, timezone,
    characterPackId, characterGearConfig,
    cooName, cooModelPackId, cooGearConfig,
    adminName, adminModelPackId, adminGearConfig,
    searchProvider, searchApiKey, searchBaseUrl,
    ttsProvider, ttsVoice, ttsApiKey, ttsBaseUrl,
    openCodeEnabled, openCodeInteractive, openCodeUseSameProvider,
    openCodeProvider, openCodeModel, openCodeApiKey, openCodeBaseUrl,
  ]);

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
        // Auto-select first fetched model if no model is currently set (except for openrouter)
        if (data.models.length > 0 && prov !== "openrouter") {
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

  // Close model dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelComboRef.current && !modelComboRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
      if (openCodeModelComboRef.current && !openCodeModelComboRef.current.contains(e.target as Node)) {
        setOpenCodeModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // OpenCode model probing when credentials change
  const effectiveOpenCodeProvider = openCodeUseSameProvider ? provider : openCodeProvider;
  const effectiveOpenCodeApiKey = openCodeUseSameProvider ? apiKey : openCodeApiKey;
  const effectiveOpenCodeBaseUrl = openCodeUseSameProvider ? baseUrl : openCodeBaseUrl;

  useEffect(() => {
    if (!effectiveOpenCodeProvider || !openCodeEnabled) return;

    if (openCodeProbeTimerRef.current) clearTimeout(openCodeProbeTimerRef.current);
    openCodeProbeTimerRef.current = setTimeout(async () => {
      const needsKey = NEEDS_API_KEY.has(effectiveOpenCodeProvider);
      const needsUrl = NEEDS_BASE_URL.has(effectiveOpenCodeProvider);
      if (needsKey && !effectiveOpenCodeApiKey) return;
      if (needsUrl && !effectiveOpenCodeBaseUrl) return;

      setOpenCodeFetchingModels(true);
      try {
        const res = await fetch("/api/setup/probe-models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: effectiveOpenCodeProvider,
            apiKey: effectiveOpenCodeApiKey || undefined,
            baseUrl: effectiveOpenCodeBaseUrl || undefined,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { models: string[] };
          setOpenCodeFetchedModels(data.models);
          if (data.models.length > 0) {
            setOpenCodeModel((prev) => prev || data.models[0]);
          }
        }
      } catch {
        // Silently fail
      } finally {
        setOpenCodeFetchingModels(false);
      }
    }, 600);

    return () => {
      if (openCodeProbeTimerRef.current) clearTimeout(openCodeProbeTimerRef.current);
    };
  }, [effectiveOpenCodeProvider, effectiveOpenCodeApiKey, effectiveOpenCodeBaseUrl, openCodeEnabled]);

  // Auto-set default coding model when "same provider" is used
  useEffect(() => {
    if (openCodeUseSameProvider && provider && !openCodeModel) {
      const suggestions = CODING_SUGGESTED_MODELS[provider];
      if (suggestions && suggestions.length > 0) {
        setOpenCodeModel(suggestions[0]);
      }
    }
  }, [openCodeUseSameProvider, provider, openCodeModel]);

  const handleSelectProvider = (id: string) => {
    setProvider(id);
    setFetchedModels([]);
    setModelFilter("");
    setModelDropdownOpen(false);
    // Set default provider name from type label
    const typeMeta = providerTypes.find((pt) => pt.type === id);
    setProviderName(typeMeta?.label || id);
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

  const handleNextFromPassphrase = async () => {
    if (passphrase.length < 8) {
      setError("Passphrase must be at least 8 characters");
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setError("Passphrases do not match");
      return;
    }
    const success = await setSetupPassphrase(passphrase);
    if (success) {
      setError(null);
      setStep(2);
    }
  };

  const handleNextToProfile = () => {
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
    setStep(4);
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

  const handleNextToUserCharacter = () => {
    if (!displayName.trim()) {
      setError("Display name is required");
      return;
    }
    if (!timezone) {
      setError("Timezone is required");
      return;
    }
    setError(null);
    loadPacks();
    setStep(5);
  };

  const handleNextToCoo = () => {
    setError(null);
    setStep(6);
  };

  const handleNextToAdmin = () => {
    if (!cooName.trim()) {
      setError("A name for your COO is required");
      return;
    }
    setError(null);
    setStep(7);
  };

  const handleNextToSearch = () => {
    if (!adminName.trim()) {
      setError("A name for your Admin Assistant is required");
      return;
    }
    setError(null);
    setStep(8);
  };

  const handleNextToOpenCode = () => {
    setError(null);
    // Auto-set default coding model if using same provider and no model selected
    if (openCodeUseSameProvider && provider && !openCodeModel) {
      const suggestions = CODING_SUGGESTED_MODELS[provider];
      if (suggestions && suggestions.length > 0) {
        setOpenCodeModel(suggestions[0]);
      }
    }
    setStep(9);
  };

  const handleNextToVoice = () => {
    setError(null);
    setStep(10);
  };

  const handleComplete = async () => {
    setSubmitting(true);
    const ok = await completeSetup({
      provider,
      providerName: providerName || undefined,
      model,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
      userName: displayName.trim(),
      userAvatar: avatar || undefined,
      userBio: bio.trim() || undefined,
      userTimezone: timezone,
      ttsVoice: ttsVoice || undefined,
      ttsProvider: ttsProvider || undefined,
      userModelPackId: characterPackId || undefined,
      userGearConfig: characterGearConfig || undefined,
      cooName: cooName.trim(),
      cooModelPackId: cooModelPackId || undefined,
      cooGearConfig: cooGearConfig || undefined,
      searchProvider: searchProvider || undefined,
      searchApiKey: searchApiKey || undefined,
      searchBaseUrl: searchBaseUrl || undefined,
      adminName: adminName.trim(),
      adminModelPackId: adminModelPackId || undefined,
      adminGearConfig: adminGearConfig || undefined,
      openCodeEnabled: openCodeEnabled || undefined,
      openCodeInteractive: openCodeEnabled ? openCodeInteractive : undefined,
      openCodeProvider: openCodeEnabled
        ? (openCodeUseSameProvider ? provider : openCodeProvider) || undefined
        : undefined,
      openCodeModel: openCodeEnabled ? openCodeModel || undefined : undefined,
      openCodeApiKey: openCodeEnabled && !openCodeUseSameProvider
        ? openCodeApiKey || undefined
        : undefined,
      openCodeBaseUrl: openCodeEnabled && !openCodeUseSameProvider
        ? openCodeBaseUrl || undefined
        : undefined,
    });
    setSubmitting(false);
    if (ok) clearWizardState();
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
        body: JSON.stringify({ voice, provider: ttsProvider || "kokoro" }),
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
            <h1 className="text-lg font-semibold tracking-tight">Otterbot</h1>
          </div>
          <p className="text-center text-sm text-muted-foreground mb-6">
            Initial Setup
          </p>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && (
                  <div className={`w-6 h-px ${step >= s ? "bg-primary" : "bg-muted"}`} />
                )}
                <div className={`w-2 h-2 rounded-full ${step >= s ? "bg-primary" : "bg-muted"}`} />
              </div>
            ))}
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium">
                1. Set a passphrase to protect the UI
              </h2>
              <p className="text-xs text-muted-foreground">
                You will need this passphrase to access Otterbot. Minimum 8
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
                    if (e.key === "Enter") handleNextFromPassphrase();
                  }}
                  placeholder="Confirm your passphrase"
                  className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <button
                onClick={handleNextFromPassphrase}
                disabled={!passphrase || !confirmPassphrase}
                className="w-full px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium">
                2. Welcome to OtterBot!
              </h2>
              <div className="text-xs text-muted-foreground space-y-3">
                <p>Thanks for trying OtterBot! This is still experimental and is not feature complete. Things you should do:</p>
                <ol className="list-decimal list-inside space-y-2 ml-1">
                  <li>Use <strong>GPTOSS 120B</strong> or something similar for the main model. The assistant has several layers and it doesn&apos;t need a lot of smarts to communicate to you. Fast is what matters.</li>
                  <li><strong>qwen3-coder-next</strong> inside of opencode works great for coding tasks.</li>
                  <li>The way we use Claude Code, Gemini, and Codex is via a terminal so it shouldn&apos;t violate TOS. I am not a lawyer so I can&apos;t guarantee that so make your own judgement.</li>
                  <li>If it breaks you get to keep both pieces. I am not responsible if something happens.</li>
                  <li>Create accounts for your agents. <strong>DO NOT</strong> connect it to your email or github accounts. Create their own accounts and you can invite them to your projects.</li>
                </ol>
              </div>

              <button
                onClick={() => setStep(3)}
                className="w-full px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors"
              >
                OK, I understand
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium">
                3. Configure your LLM provider
              </h2>

              {/* Provider type cards */}
              <div className="grid grid-cols-2 gap-2">
                {providerTypes.map((pt) => (
                  <button
                    key={pt.type}
                    onClick={() => handleSelectProvider(pt.type)}
                    className={`p-3 rounded-md border text-left text-sm transition-colors ${
                      provider === pt.type
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-muted-foreground"
                    }`}
                  >
                    <div className="font-medium">{pt.label}</div>
                  </button>
                ))}
              </div>

              {provider && (
                <p className="text-xs text-muted-foreground">
                  {PROVIDER_DESCRIPTIONS[provider]}
                </p>
              )}

              {/* Provider Name */}
              {provider && (
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">
                    Provider Name
                  </label>
                  <input
                    type="text"
                    value={providerName}
                    onChange={(e) => setProviderName(e.target.value)}
                    placeholder="e.g. My Anthropic, Work OpenAI"
                    className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    A friendly name for this provider connection. You can add more providers later.
                  </p>
                </div>
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

                  {/* Suggested model chips */}
                  {(() => {
                    const suggested = SUGGESTED_MODELS[provider] ?? [];
                    return suggested.length > 0 ? (
                      <div className="flex gap-1.5 mb-2 flex-wrap">
                        {suggested.map((m) => (
                          <button
                            key={m}
                            onClick={() => {
                              setModel(m);
                              setModelFilter("");
                              setModelDropdownOpen(false);
                            }}
                            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                              model === m
                                ? "border-primary text-primary"
                                : "border-border text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    ) : null;
                  })()}

                  {/* Searchable model combobox */}
                  <div ref={modelComboRef} className="relative">
                    <input
                      type="text"
                      value={modelDropdownOpen ? modelFilter : model}
                      onChange={(e) => {
                        setModelFilter(e.target.value);
                        setModel(e.target.value);
                        setModelDropdownOpen(true);
                      }}
                      onFocus={() => {
                        setModelFilter(model);
                        setModelDropdownOpen(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setModelDropdownOpen(false);
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      placeholder="Search or type a model name"
                      aria-describedby="model-search-hint"
                      className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <p id="model-search-hint" data-testid="model-search-hint" className="mt-1.5 text-xs text-muted-foreground">
                      Type to search and filter available models, or enter a custom model name.
                    </p>
                    {fetchingModels && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        Loading...
                      </span>
                    )}
                    {!fetchingModels && fetchedModels.length > 0 && !modelDropdownOpen && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        {fetchedModels.length} models
                      </span>
                    )}

                    {/* Dropdown */}
                    {modelDropdownOpen && fetchedModels.length > 0 && (() => {
                      const filtered = fetchedModels.filter((m) =>
                        m.toLowerCase().includes(modelFilter.toLowerCase()),
                      );
                      return filtered.length > 0 ? (
                        <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-md shadow-md max-h-[300px] overflow-y-auto">
                          {filtered.map((m) => (
                            <button
                              key={m}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setModel(m);
                                setModelFilter("");
                                setModelDropdownOpen(false);
                              }}
                              className={`w-full text-left px-4 py-2.5 text-sm hover:bg-accent transition-colors ${
                                model === m ? "bg-accent text-accent-foreground" : "text-foreground"
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>
              )}

              {/* Model pricing check */}
              {provider && model && <ModelPricingPrompt model={model} />}

              {/* Model strategy tip */}
              {provider && model && (
                <div className="text-xs text-muted-foreground bg-secondary/50 border border-border rounded-md px-3 py-2.5 leading-relaxed">
                  This provider and model will be used for all agent tiers initially. After setup, you
                  can configure different models per tier in Settings. <span className="text-foreground font-medium">Tip:</span> Assign
                  a reasoning model (like Claude Opus or Sonnet 4.5) to the Team Lead for better
                  planning. Workers can use cheaper/faster models since they execute the Team Lead's
                  detailed plans.
                </div>
              )}

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
                  onClick={handleNextToProfile}
                  disabled={!provider || !model}
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
                4. Tell the team about yourself
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
                    setStep(3);
                    setError(null);
                  }}
                  className="px-4 py-2 bg-secondary text-secondary-foreground text-sm font-medium rounded-md hover:bg-secondary/80 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleNextToUserCharacter}
                  disabled={!displayName.trim() || !timezone}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium">
                5. Choose your character
              </h2>
              <p className="text-xs text-muted-foreground">
                Pick a 3D character for the Live View. You can change this later in Settings.
              </p>

              <CharacterSelect
                packs={modelPacks}
                selected={characterPackId}
                onSelect={setCharacterPackId}
                loading={modelPacksLoading}
                gearConfig={characterGearConfig}
                onGearConfigChange={setCharacterGearConfig}
              />

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStep(4);
                    setError(null);
                  }}
                  className="px-4 py-2 bg-secondary text-secondary-foreground text-sm font-medium rounded-md hover:bg-secondary/80 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleNextToCoo}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium">
                6. Customize your COO
              </h2>
              <p className="text-xs text-muted-foreground">
                Your COO manages all operations and reports directly to you. Give them a name and optionally pick a 3D character.
              </p>

              {/* COO Name */}
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">
                  Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={cooName}
                  onChange={(e) => setCooName(e.target.value)}
                  placeholder="e.g. Atlas, Friday, Jarvis..."
                  autoFocus
                  className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* COO 3D Character */}
              <CharacterSelect
                packs={modelPacks}
                selected={cooModelPackId}
                onSelect={(id) => { setCooModelPackId(id); setCooGearConfig(null); }}
                loading={modelPacksLoading}
                gearConfig={cooGearConfig}
                onGearConfigChange={setCooGearConfig}
                excludeIds={[characterPackId].filter(Boolean) as string[]}
              />

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStep(5);
                    setError(null);
                  }}
                  className="px-4 py-2 bg-secondary text-secondary-foreground text-sm font-medium rounded-md hover:bg-secondary/80 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleNextToAdmin}
                  disabled={!cooName.trim()}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 7 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium">
                7. Customize your Admin Assistant
              </h2>
              <p className="text-xs text-muted-foreground">
                Your Admin Assistant handles personal productivity — managing your todos, email (Gmail), and calendar. Give them a name and optionally pick a 3D character.
              </p>

              {/* Admin Assistant Name */}
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">
                  Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="e.g. Pepper, Friday, Sage..."
                  autoFocus
                  className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Admin Assistant 3D Character */}
              <CharacterSelect
                packs={modelPacks}
                selected={adminModelPackId}
                onSelect={(id) => { setAdminModelPackId(id); setAdminGearConfig(null); }}
                loading={modelPacksLoading}
                gearConfig={adminGearConfig}
                onGearConfigChange={setAdminGearConfig}
                excludeIds={[characterPackId, cooModelPackId].filter(Boolean) as string[]}
              />

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStep(6);
                    setError(null);
                  }}
                  className="px-4 py-2 bg-secondary text-secondary-foreground text-sm font-medium rounded-md hover:bg-secondary/80 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleNextToSearch}
                  disabled={!adminName.trim()}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 8 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium">
                8. Set up web search
              </h2>
              <p className="text-xs text-muted-foreground">
                Give your agents the ability to search the web. DuckDuckGo works
                out of the box — or configure a different provider.
              </p>

              {/* Search provider cards */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "duckduckgo", name: "DuckDuckGo", desc: "Free, no setup needed" },
                  { id: "brave", name: "Brave Search", desc: "Requires API key" },
                  { id: "tavily", name: "Tavily", desc: "Requires API key" },
                  { id: "searxng", name: "SearXNG", desc: "Self-hosted, needs URL" },
                ].map((sp) => (
                  <button
                    key={sp.id}
                    onClick={() => {
                      setSearchProvider(sp.id);
                      setSearchApiKey("");
                      setSearchBaseUrl("");
                      setError(null);
                    }}
                    className={`p-3 rounded-md border text-left text-sm transition-colors ${
                      searchProvider === sp.id
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-muted-foreground"
                    }`}
                  >
                    <div className="font-medium">{sp.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{sp.desc}</div>
                  </button>
                ))}
              </div>

              {/* API Key for Brave / Tavily */}
              {(searchProvider === "brave" || searchProvider === "tavily") && (
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={searchApiKey}
                    onChange={(e) => setSearchApiKey(e.target.value)}
                    placeholder={searchProvider === "brave" ? "BSA..." : "tvly-..."}
                    className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}

              {/* Base URL for SearXNG */}
              {searchProvider === "searxng" && (
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={searchBaseUrl}
                    onChange={(e) => setSearchBaseUrl(e.target.value)}
                    placeholder="http://localhost:8080"
                    className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStep(7);
                    setError(null);
                  }}
                  className="px-4 py-2 bg-secondary text-secondary-foreground text-sm font-medium rounded-md hover:bg-secondary/80 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleNextToOpenCode}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors"
                >
                  Next
                </button>
              </div>

              <button
                onClick={() => {
                  setSearchProvider("");
                  handleNextToOpenCode();
                }}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip — set up search later
              </button>
            </div>
          )}

          {step === 9 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium">
                9. Configure Coding Agents
              </h2>
              <p className="text-xs text-muted-foreground">
                Coding agents are autonomous tools that handle multi-file edits, refactoring, and complex code changes.
                Configure OpenCode below. Claude Code and Codex can be configured later in Settings &gt; Coding Agents.
              </p>

              {/* Enable toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => setOpenCodeEnabled(!openCodeEnabled)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    openCodeEnabled ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      openCodeEnabled ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </div>
                <span className="text-sm">Enable OpenCode for coding tasks</span>
              </label>

              {openCodeEnabled && (
                <>
                  {/* Interactive mode toggle */}
                  <label className="flex items-center gap-3 cursor-pointer">
                    <div
                      onClick={() => setOpenCodeInteractive(!openCodeInteractive)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${
                        openCodeInteractive ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          openCodeInteractive ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </div>
                    <div>
                      <span className="text-sm">Interactive mode</span>
                      <p className="text-[10px] text-muted-foreground">
                        Pause and ask for your input instead of running fully autonomously.
                      </p>
                    </div>
                  </label>

                  {/* Same provider checkbox */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={openCodeUseSameProvider}
                      onChange={(e) => {
                        setOpenCodeUseSameProvider(e.target.checked);
                        if (e.target.checked) {
                          setOpenCodeProvider("");
                          setOpenCodeApiKey("");
                          setOpenCodeBaseUrl("");
                          setOpenCodeFetchedModels([]);
                        }
                      }}
                      className="rounded border-border"
                    />
                    <span className="text-sm text-muted-foreground">Use same provider as COO</span>
                  </label>

                  {/* Different provider selection */}
                  {!openCodeUseSameProvider && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {providerTypes.map((pt) => (
                          <button
                            key={pt.type}
                            onClick={() => {
                              setOpenCodeProvider(pt.type);
                              setOpenCodeFetchedModels([]);
                              setOpenCodeModelFilter("");
                              setOpenCodeModelDropdownOpen(false);
                              const suggestions = CODING_SUGGESTED_MODELS[pt.type];
                              if (suggestions && suggestions.length > 0) {
                                setOpenCodeModel(suggestions[0]);
                              } else {
                                setOpenCodeModel("");
                              }
                              if (pt.type === "ollama" && !openCodeBaseUrl) {
                                setOpenCodeBaseUrl("http://localhost:11434/api");
                              }
                            }}
                            className={`p-3 rounded-md border text-left text-sm transition-colors ${
                              openCodeProvider === pt.type
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border bg-background text-muted-foreground hover:border-muted-foreground"
                            }`}
                          >
                            <div className="font-medium">{pt.label}</div>
                          </button>
                        ))}
                      </div>

                      {openCodeProvider && NEEDS_API_KEY.has(openCodeProvider) && (
                        <div>
                          <label className="block text-sm text-muted-foreground mb-1.5">API Key</label>
                          <input
                            type="password"
                            value={openCodeApiKey}
                            onChange={(e) => setOpenCodeApiKey(e.target.value)}
                            placeholder="sk-..."
                            className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                      )}

                      {openCodeProvider && NEEDS_BASE_URL.has(openCodeProvider) && (
                        <div>
                          <label className="block text-sm text-muted-foreground mb-1.5">Base URL</label>
                          <input
                            type="text"
                            value={openCodeBaseUrl}
                            onChange={(e) => setOpenCodeBaseUrl(e.target.value)}
                            placeholder="http://localhost:11434/api"
                            className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                      )}
                    </>
                  )}

                  {/* Model selector */}
                  <div>
                    <label className="block text-sm text-muted-foreground mb-1.5">
                      Coding Model
                    </label>

                    {/* Suggested coding model chips */}
                    {(() => {
                      const prov = openCodeUseSameProvider ? provider : openCodeProvider;
                      const suggested = CODING_SUGGESTED_MODELS[prov] ?? [];
                      return suggested.length > 0 ? (
                        <div className="flex gap-1.5 mb-2 flex-wrap">
                          {suggested.map((m) => (
                            <button
                              key={m}
                              onClick={() => {
                                setOpenCodeModel(m);
                                setOpenCodeModelFilter("");
                                setOpenCodeModelDropdownOpen(false);
                              }}
                              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                                openCodeModel === m
                                  ? "border-primary text-primary"
                                  : "border-border text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      ) : null;
                    })()}

                    {/* Searchable model combobox */}
                    <div ref={openCodeModelComboRef} className="relative">
                      <input
                        type="text"
                        value={openCodeModelDropdownOpen ? openCodeModelFilter : openCodeModel}
                        onChange={(e) => {
                          setOpenCodeModelFilter(e.target.value);
                          setOpenCodeModel(e.target.value);
                          setOpenCodeModelDropdownOpen(true);
                        }}
                        onFocus={() => {
                          setOpenCodeModelFilter(openCodeModel);
                          setOpenCodeModelDropdownOpen(true);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setOpenCodeModelDropdownOpen(false);
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        placeholder="Search or type a model name"
                        aria-describedby="opencode-model-search-hint"
                        className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <p id="opencode-model-search-hint" data-testid="model-search-hint" className="mt-1.5 text-xs text-muted-foreground">
                        Type to search and filter available models, or enter a custom model name.
                      </p>
                      {openCodeFetchingModels && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          Loading...
                        </span>
                      )}
                      {!openCodeFetchingModels && openCodeFetchedModels.length > 0 && !openCodeModelDropdownOpen && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          {openCodeFetchedModels.length} models
                        </span>
                      )}

                      {openCodeModelDropdownOpen && openCodeFetchedModels.length > 0 && (() => {
                        const filtered = openCodeFetchedModels.filter((m) =>
                          m.toLowerCase().includes(openCodeModelFilter.toLowerCase()),
                        );
                        return filtered.length > 0 ? (
                        <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-md shadow-md max-h-[300px] overflow-y-auto">
                            {filtered.map((m) => (
                              <button
                                key={m}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setOpenCodeModel(m);
                                  setOpenCodeModelFilter("");
                                  setOpenCodeModelDropdownOpen(false);
                                }}
                              className={`w-full text-left px-4 py-2.5 text-sm hover:bg-accent transition-colors ${
                                  openCodeModel === m ? "bg-accent text-accent-foreground" : "text-foreground"
                                }`}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                        ) : null;
                      })()}
                    </div>
                  </div>
                </>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStep(8);
                    setError(null);
                  }}
                  className="px-4 py-2 bg-secondary text-secondary-foreground text-sm font-medium rounded-md hover:bg-secondary/80 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleNextToVoice}
                  disabled={openCodeEnabled && !openCodeModel}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>

              <button
                onClick={() => {
                  setOpenCodeEnabled(false);
                  handleNextToVoice();
                }}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip — disable OpenCode
              </button>
            </div>
          )}

          {step === 10 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium">
                10. Choose a voice for your assistant
              </h2>
              <p className="text-xs text-muted-foreground">
                Your assistant can speak its responses aloud. Pick a TTS
                provider, choose a voice, or skip to use text only.
              </p>

              {/* TTS provider picker */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "kokoro", name: "Kokoro", desc: "Local, private. ~100MB model download on first use." },
                  { id: "edge-tts", name: "Edge TTS", desc: "Free cloud service by Microsoft. No API key needed." },
                  { id: "openai-compatible", name: "OpenAI TTS", desc: "Requires API key & endpoint." },
                ].map((tp) => (
                  <button
                    key={tp.id}
                    onClick={() => {
                      setTtsProvider(tp.id);
                      setTtsVoice(null);
                      setError(null);
                    }}
                    className={`p-3 rounded-md border text-left text-xs transition-colors ${
                      ttsProvider === tp.id
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-muted-foreground"
                    }`}
                  >
                    <div className="font-medium text-sm">{tp.name}</div>
                    <div className="text-muted-foreground mt-0.5 leading-snug">{tp.desc}</div>
                  </button>
                ))}
              </div>

              {/* OpenAI-compatible config fields */}
              {ttsProvider === "openai-compatible" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-muted-foreground mb-1.5">
                      API Key
                    </label>
                    <input
                      type="password"
                      value={ttsApiKey}
                      onChange={(e) => setTtsApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-muted-foreground mb-1.5">
                      Base URL
                    </label>
                    <input
                      type="text"
                      value={ttsBaseUrl}
                      onChange={(e) => setTtsBaseUrl(e.target.value)}
                      placeholder="https://api.openai.com"
                      className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              )}

              {/* Voice grid — Kokoro */}
              {ttsProvider === "kokoro" && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                    Female voices
                  </p>
                  <div className="grid grid-cols-3 gap-1.5 mb-3">
                    {["af_heart", "af_bella", "af_nicole", "af_aoede", "af_kore", "af_sarah", "af_sky"].map((v) => (
                      <VoiceButton key={v} voice={v} label={v.replace("af_", "")} ttsVoice={ttsVoice} previewingVoice={previewingVoice} onPreview={handlePreviewVoice} />
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                    Male voices
                  </p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {["am_adam", "am_michael", "am_echo", "am_eric", "am_liam", "am_onyx"].map((v) => (
                      <VoiceButton key={v} voice={v} label={v.replace("am_", "")} ttsVoice={ttsVoice} previewingVoice={previewingVoice} onPreview={handlePreviewVoice} />
                    ))}
                  </div>
                </div>
              )}

              {/* Voice grid — Edge TTS */}
              {ttsProvider === "edge-tts" && (
                <div className="space-y-3">
                  {[
                    { label: "English (US)", voices: ["en-US-AriaNeural", "en-US-JennyNeural", "en-US-GuyNeural", "en-US-DavisNeural", "en-US-SaraNeural"] },
                    { label: "English (GB)", voices: ["en-GB-SoniaNeural", "en-GB-RyanNeural", "en-GB-LibbyNeural"] },
                    { label: "German", voices: ["de-DE-KatjaNeural", "de-DE-ConradNeural"] },
                    { label: "French", voices: ["fr-FR-DeniseNeural", "fr-FR-HenriNeural"] },
                    { label: "Spanish", voices: ["es-ES-ElviraNeural", "es-ES-AlvaroNeural"] },
                    { label: "Japanese", voices: ["ja-JP-NanamiNeural", "ja-JP-KeitaNeural"] },
                    { label: "More", voices: ["it-IT-ElsaNeural", "pt-BR-FranciscaNeural", "zh-CN-XiaoxiaoNeural", "ko-KR-SunHiNeural", "hi-IN-SwaraNeural"] },
                  ].map((group) => (
                    <div key={group.label}>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
                        {group.label}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {group.voices.map((v) => (
                          <VoiceButton key={v} voice={v} label={v.replace(/^[a-z]{2}-[A-Z]{2}-/, "").replace(/Neural$/, "")} ttsVoice={ttsVoice} previewingVoice={previewingVoice} onPreview={handlePreviewVoice} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Voice grid — OpenAI-compatible */}
              {ttsProvider === "openai-compatible" && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                    Voices
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {["alloy", "echo", "fable", "onyx", "nova", "shimmer"].map((v) => (
                      <VoiceButton key={v} voice={v} label={v} ttsVoice={ttsVoice} previewingVoice={previewingVoice} onPreview={handlePreviewVoice} />
                    ))}
                  </div>
                </div>
              )}

              {/* Loading status bar */}
              {previewingVoice && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary rounded-md px-3 py-2">
                  <svg className="animate-spin h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>
                    {ttsProvider === "kokoro"
                      ? "Generating preview... First time may take 30\u201360s while the voice model downloads."
                      : "Generating preview..."}
                  </span>
                </div>
              )}

              {!previewingVoice && ttsProvider && (
                <p className="text-[10px] text-muted-foreground">
                  Click a voice to hear a preview. More voices are available in
                  Settings after setup.
                </p>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStep(9);
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
                  {submitting ? "Setting up..." : "Complete Setup"}
                </button>
              </div>

              <button
                onClick={() => {
                  setTtsVoice(null);
                  setTtsProvider(null);
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
