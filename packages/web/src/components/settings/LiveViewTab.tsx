import { useState, useEffect } from "react";
import { useModelPackStore } from "../../stores/model-pack-store";
import { CharacterSelect } from "../character-select/CharacterSelect";
import type { GearConfig } from "@smoothbot/shared";

export function LiveViewTab() {
  const packs = useModelPackStore((s) => s.packs);
  const loadPacks = useModelPackStore((s) => s.loadPacks);
  const [ceoModelPackId, setCeoModelPackId] = useState<string | null>(null);
  const [gearConfig, setGearConfig] = useState<GearConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadPacks();
    // Load current profile model pack
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        setCeoModelPackId(data.modelPackId ?? null);
        setGearConfig(data.gearConfig ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [loadPacks]);

  const handleSelect = async (id: string | null) => {
    setCeoModelPackId(id);
    // Reset gear config when switching packs
    setGearConfig(null);
    setSaving(true);
    try {
      await fetch("/api/profile/model-pack", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelPackId: id, gearConfig: null }),
      });
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  const handleGearConfigChange = async (config: GearConfig | null) => {
    setGearConfig(config);
    setSaving(true);
    try {
      await fetch("/api/profile/model-pack", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelPackId: ceoModelPackId, gearConfig: config }),
      });
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-1">CEO Character</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Choose your 3D character for the Live View.
          {saving && <span className="ml-2 text-primary">Saving...</span>}
        </p>
      </div>

      <CharacterSelect
        packs={packs}
        selected={ceoModelPackId}
        onSelect={handleSelect}
        gearConfig={gearConfig}
        onGearConfigChange={handleGearConfigChange}
      />
    </div>
  );
}
