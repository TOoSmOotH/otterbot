import { useState, useEffect } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { ModelCombobox } from "./ModelCombobox";

const TIER_LABELS: Record<string, { label: string; hint: string; tip?: string }> = {
  coo: {
    label: "COO (Chief Operating Officer)",
    hint: "The main orchestration agent. All other tiers fall back to this default.",
  },
  teamLead: {
    label: "Team Lead",
    hint: "Manages projects and coordinates workers. Falls back to COO default if not set.",
    tip: "Tip: Use a reasoning model (e.g., Claude Opus, Sonnet 4.5) for better task planning and decomposition.",
  },
  worker: {
    label: "Worker",
    hint: "Executes tasks (coding, research, etc.). Falls back to COO default if not set.",
    tip: "Tip: Workers execute detailed plans from the Team Lead, so cheaper/faster models work well here to save costs.",
  },
};

export function ModelsTab() {
  const defaults = useSettingsStore((s) => s.defaults);
  const providers = useSettingsStore((s) => s.providers);
  const models = useSettingsStore((s) => s.models);
  const customModels = useSettingsStore((s) => s.customModels);
  const updateDefaults = useSettingsStore((s) => s.updateDefaults);
  const fetchModels = useSettingsStore((s) => s.fetchModels);
  const loadCustomModels = useSettingsStore((s) => s.loadCustomModels);
  const createCustomModel = useSettingsStore((s) => s.createCustomModel);
  const deleteCustomModel = useSettingsStore((s) => s.deleteCustomModel);

  const [form, setForm] = useState({
    coo: { ...defaults.coo },
    teamLead: { ...defaults.teamLead },
    worker: { ...defaults.worker },
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Custom model form
  const [cmProviderId, setCmProviderId] = useState("");
  const [cmModelId, setCmModelId] = useState("");
  const [cmLabel, setCmLabel] = useState("");

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
      if (p.apiKeySet || p.type === "ollama") {
        fetchModels(p.id);
      }
    }
    loadCustomModels();
    // Default the custom model provider selector to first provider
    if (providers.length > 0 && !cmProviderId) {
      setCmProviderId(providers[0].id);
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

  const handleAddCustomModel = async () => {
    if (!cmProviderId || !cmModelId.trim()) return;
    await createCustomModel({
      providerId: cmProviderId,
      modelId: cmModelId.trim(),
      label: cmLabel.trim() || undefined,
    });
    setCmModelId("");
    setCmLabel("");
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

            {tierInfo.tip && (
              <p className="text-[11px] text-primary/80 bg-primary/5 border border-primary/10 rounded-md px-3 py-2">
                {tierInfo.tip}
              </p>
            )}

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
                  {providers.length === 0 && (
                    <option value="">No providers configured</option>
                  )}
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.type})
                    </option>
                  ))}
                </select>
              </div>

              {/* Model combobox */}
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                  Model
                </label>
                <ModelCombobox
                  value={form[tier].model}
                  options={providerModels}
                  onChange={(model) => handleModelChange(tier, model)}
                  placeholder="e.g. claude-sonnet-4-5-20250929"
                />
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

      {/* Custom Models section */}
      <div className="border-t border-border pt-6 space-y-4">
        <div>
          <h3 className="text-sm font-medium">Custom Models</h3>
          <p className="text-[10px] text-muted-foreground">
            Manually add model IDs that aren't auto-discovered. These appear in all model dropdowns for the selected provider.
          </p>
        </div>

        {/* Add form */}
        <div className="flex items-end gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
              Provider
            </label>
            <select
              value={cmProviderId}
              onChange={(e) => setCmProviderId(e.target.value)}
              className="bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
              Model ID
            </label>
            <input
              type="text"
              value={cmModelId}
              onChange={(e) => setCmModelId(e.target.value)}
              placeholder="e.g. my-custom-model"
              className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddCustomModel();
              }}
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
              Label (optional)
            </label>
            <input
              type="text"
              value={cmLabel}
              onChange={(e) => setCmLabel(e.target.value)}
              placeholder="Display name"
              className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddCustomModel();
              }}
            />
          </div>
          <button
            onClick={handleAddCustomModel}
            disabled={!cmModelId.trim()}
            className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50 whitespace-nowrap"
          >
            Add
          </button>
        </div>

        {/* Custom models list */}
        {customModels.length > 0 && (
          <div className="space-y-1">
            {customModels.map((cm) => {
              const prov = providers.find((p) => p.id === cm.providerId);
              return (
                <div
                  key={cm.id}
                  className="flex items-center justify-between bg-secondary/50 rounded-md px-3 py-1.5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded shrink-0">
                      {prov?.name ?? cm.providerId}
                    </span>
                    <span className="text-sm font-mono truncate">{cm.modelId}</span>
                    {cm.label && (
                      <span className="text-xs text-muted-foreground truncate">
                        ({cm.label})
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => deleteCustomModel(cm.id)}
                    className="text-xs text-destructive hover:bg-destructive/10 px-2 py-0.5 rounded shrink-0"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
