import { useState, useEffect } from "react";
import { useSettingsStore } from "../../stores/settings-store";

const TIER_LABELS: Record<string, { label: string; hint: string }> = {
  coo: {
    label: "COO (Chief Operating Officer)",
    hint: "The main orchestration agent. All other tiers fall back to this default.",
  },
  teamLead: {
    label: "Team Lead",
    hint: "Manages projects and coordinates workers. Falls back to COO default if not set.",
  },
  worker: {
    label: "Worker",
    hint: "Executes tasks (coding, research, etc.). Falls back to COO default if not set.",
  },
};

export function ModelsTab() {
  const defaults = useSettingsStore((s) => s.defaults);
  const providers = useSettingsStore((s) => s.providers);
  const models = useSettingsStore((s) => s.models);
  const updateDefaults = useSettingsStore((s) => s.updateDefaults);
  const fetchModels = useSettingsStore((s) => s.fetchModels);

  const [form, setForm] = useState({
    coo: { ...defaults.coo },
    teamLead: { ...defaults.teamLead },
    worker: { ...defaults.worker },
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sync form when settings reload
  useEffect(() => {
    setForm({
      coo: { ...defaults.coo },
      teamLead: { ...defaults.teamLead },
      worker: { ...defaults.worker },
    });
  }, [defaults]);

  // Fetch model lists for configured providers
  useEffect(() => {
    for (const p of providers) {
      if (p.apiKeySet || !p.needsApiKey) {
        fetchModels(p.id);
      }
    }
  }, [providers]);

  const handleProviderChange = (
    tier: "coo" | "teamLead" | "worker",
    provider: string,
  ) => {
    setForm((prev) => ({
      ...prev,
      [tier]: { ...prev[tier], provider },
    }));
    // Fetch models for this provider if we haven't yet
    if (!models[provider]) {
      fetchModels(provider);
    }
  };

  const handleModelChange = (
    tier: "coo" | "teamLead" | "worker",
    model: string,
  ) => {
    setForm((prev) => ({
      ...prev,
      [tier]: { ...prev[tier], model },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    await updateDefaults(form);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-5 space-y-6">
      <p className="text-xs text-muted-foreground">
        Set the default LLM provider and model for each agent tier. Team Lead and Worker
        fall back to the COO default when not explicitly configured.
      </p>

      {(["coo", "teamLead", "worker"] as const).map((tier) => {
        const tierInfo = TIER_LABELS[tier];
        const providerModels = models[form[tier].provider] ?? [];

        return (
          <div key={tier} className="border border-border rounded-lg p-4 space-y-3">
            <div>
              <h3 className="text-sm font-medium">{tierInfo.label}</h3>
              <p className="text-[10px] text-muted-foreground">{tierInfo.hint}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Provider select */}
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                  Provider
                </label>
                <select
                  value={form[tier].provider}
                  onChange={(e) => handleProviderChange(tier, e.target.value)}
                  className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Model input with datalist */}
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                  Model
                </label>
                <input
                  type="text"
                  value={form[tier].model}
                  onChange={(e) => handleModelChange(tier, e.target.value)}
                  list={`models-${tier}`}
                  placeholder="e.g. claude-sonnet-4-5-20250929"
                  className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                />
                <datalist id={`models-${tier}`}>
                  {providerModels.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
            </div>
          </div>
        );
      })}

      {/* Save button */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs bg-primary text-primary-foreground px-4 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
        {saved && (
          <span className="text-xs text-green-500">{"\u2713"} Saved</span>
        )}
      </div>
    </div>
  );
}
