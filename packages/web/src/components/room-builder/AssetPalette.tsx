import { useState, useMemo } from "react";
import { useEnvironmentStore } from "../../stores/environment-store";
import { useRoomBuilderStore } from "../../stores/room-builder-store";
import { categorizeAssets } from "../../lib/asset-categories";

export function AssetPalette() {
  const packs = useEnvironmentStore((s) => s.packs);
  const addProp = useRoomBuilderStore((s) => s.addProp);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const allAssets = useMemo(() => {
    return packs.flatMap((pack) =>
      pack.assets.map((asset) => ({
        ...asset,
        packId: pack.id,
        ref: `${pack.id}/${asset.id}`,
      })),
    );
  }, [packs]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allAssets;
    const q = search.toLowerCase();
    return allAssets.filter((a) => a.name.toLowerCase().includes(q));
  }, [allAssets, search]);

  const categorized = useMemo(() => {
    return categorizeAssets(filtered);
  }, [filtered]);

  const toggleCategory = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const formatName = (name: string) => {
    return name.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  };

  return (
    <div className="absolute left-2 top-14 bottom-2 w-52 z-10 bg-card/90 backdrop-blur-sm border border-border rounded-lg shadow-lg flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-xs font-semibold text-foreground mb-1.5">Assets</h3>
        <input
          type="text"
          placeholder="Search assets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full text-xs px-2 py-1 rounded bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
      </div>

      {/* Asset list */}
      <div className="flex-1 overflow-y-auto p-1.5">
        {categorized.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No assets found</p>
        )}
        {categorized.map((cat) => (
          <div key={cat.id} className="mb-1">
            {/* Category header */}
            <button
              onClick={() => toggleCategory(cat.id)}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
            >
              <svg
                className={`w-2.5 h-2.5 transition-transform ${collapsed[cat.id] ? "" : "rotate-90"}`}
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M8 5l8 7-8 7z" />
              </svg>
              {cat.label}
              <span className="ml-auto text-[10px] text-muted-foreground/60">{cat.assets.length}</span>
            </button>

            {/* Assets */}
            {!collapsed[cat.id] && (
              <div className="ml-1">
                {cat.assets.map((asset) => {
                  const ref = `${(asset as any).packId ?? packs[0]?.id}/${asset.id}`;
                  // Find the matching asset from allAssets to get the correct ref
                  const match = allAssets.find((a) => a.id === asset.id);
                  const assetRef = match?.ref ?? ref;

                  return (
                    <button
                      key={assetRef}
                      onClick={() => addProp(assetRef)}
                      className="w-full text-left px-2 py-0.5 text-xs text-foreground/80 hover:text-foreground hover:bg-primary/10 rounded transition-colors truncate"
                      title={asset.name}
                    >
                      {formatName(asset.name)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
