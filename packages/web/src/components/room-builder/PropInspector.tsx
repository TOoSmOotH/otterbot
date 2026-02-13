import { useMemo } from "react";
import { useRoomBuilderStore, type EditableProp } from "../../stores/room-builder-store";

export function PropInspector() {
  const editingProps = useRoomBuilderStore((s) => s.editingProps);
  const selectedPropUid = useRoomBuilderStore((s) => s.selectedPropUid);
  const updatePropTransform = useRoomBuilderStore((s) => s.updatePropTransform);

  const selected = useMemo(
    () => editingProps.find((p) => p.uid === selectedPropUid),
    [editingProps, selectedPropUid],
  );

  if (!selected) return null;

  const formatName = (asset: string) => {
    const name = asset.split("/").pop() ?? asset;
    return name.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  };

  const rad2deg = (r: number) => Math.round((r * 180) / Math.PI * 100) / 100;
  const deg2rad = (d: number) => (d * Math.PI) / 180;

  const scaleValue = typeof selected.scale === "number"
    ? selected.scale
    : Array.isArray(selected.scale) ? selected.scale[0] : 1;

  return (
    <div className="absolute right-2 top-14 w-56 z-10 bg-card/90 backdrop-blur-sm border border-border rounded-lg shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-xs font-semibold text-foreground truncate">
          {formatName(selected.asset)}
        </h3>
        <p className="text-[10px] text-muted-foreground truncate">{selected.asset}</p>
      </div>

      <div className="p-3 space-y-3">
        {/* Position */}
        <VectorInput
          label="Position"
          value={selected.position}
          step={0.5}
          onChange={(pos) => updatePropTransform(selected.uid, { position: pos })}
        />

        {/* Rotation (degrees) */}
        <VectorInput
          label="Rotation"
          value={[
            rad2deg(selected.rotation?.[0] ?? 0),
            rad2deg(selected.rotation?.[1] ?? 0),
            rad2deg(selected.rotation?.[2] ?? 0),
          ]}
          step={15}
          onChange={(deg) =>
            updatePropTransform(selected.uid, {
              rotation: [deg2rad(deg[0]), deg2rad(deg[1]), deg2rad(deg[2])],
            })
          }
        />

        {/* Scale */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Scale</label>
          <div className="mt-0.5">
            <input
              type="number"
              value={scaleValue}
              step={0.1}
              min={0.01}
              onChange={(e) => {
                const v = parseFloat(e.target.value) || 1;
                updatePropTransform(selected.uid, { scale: v });
              }}
              className="w-full text-xs px-2 py-1 rounded bg-secondary border border-border text-foreground focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Shadow settings */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Shadows</label>
          <div className="flex gap-3">
            <label className="flex items-center gap-1.5 text-xs text-foreground/80">
              <input
                type="checkbox"
                checked={selected.castShadow ?? false}
                onChange={(e) =>
                  updatePropTransform(selected.uid, { castShadow: e.target.checked })
                }
                className="rounded border-border"
              />
              Cast
            </label>
            <label className="flex items-center gap-1.5 text-xs text-foreground/80">
              <input
                type="checkbox"
                checked={selected.receiveShadow ?? false}
                onChange={(e) =>
                  updatePropTransform(selected.uid, { receiveShadow: e.target.checked })
                }
                className="rounded border-border"
              />
              Receive
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function VectorInput({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: [number, number, number];
  step: number;
  onChange: (v: [number, number, number]) => void;
}) {
  const axes = ["X", "Y", "Z"] as const;

  return (
    <div>
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</label>
      <div className="grid grid-cols-3 gap-1 mt-0.5">
        {axes.map((axis, i) => (
          <div key={axis} className="relative">
            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground/60">{axis}</span>
            <input
              type="number"
              value={Math.round(value[i] * 100) / 100}
              step={step}
              onChange={(e) => {
                const newVal = [...value] as [number, number, number];
                newVal[i] = parseFloat(e.target.value) || 0;
                onChange(newVal);
              }}
              className="w-full text-xs pl-5 pr-1 py-1 rounded bg-secondary border border-border text-foreground focus:outline-none focus:border-primary"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
