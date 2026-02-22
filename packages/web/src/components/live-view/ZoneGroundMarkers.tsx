import { useMemo } from "react";
import { Line, Text } from "@react-three/drei";
import type { SceneZone } from "@otterbot/shared";

interface ZoneGroundMarkersProps {
  zones: SceneZone[];
}

const Y_OFFSET = 0.02;
const GLOW_Y_OFFSET = 0.01;

function ZoneBorder({ zone }: { zone: SceneZone }) {
  const color = zone.borderColor ?? (zone.projectId === null ? "#00ccff" : "#00ffaa");
  const glowColor = zone.borderColor ?? (zone.projectId === null ? "#0066aa" : "#009966");

  const points = useMemo(() => {
    const [px, , pz] = zone.position;
    const [sx, , sz] = zone.size;
    const x0 = px - sx / 2;
    const x1 = px + sx / 2;
    const z0 = pz - sz / 2;
    const z1 = pz + sz / 2;
    return [
      [x0, Y_OFFSET, z0],
      [x1, Y_OFFSET, z0],
      [x1, Y_OFFSET, z1],
      [x0, Y_OFFSET, z1],
      [x0, Y_OFFSET, z0],
    ] as [number, number, number][];
  }, [zone.position, zone.size]);

  const glowPoints = useMemo(
    () => points.map(([x, , z]) => [x, GLOW_Y_OFFSET, z] as [number, number, number]),
    [points],
  );

  return (
    <group>
      {/* Glow layer — wider, transparent */}
      <Line
        points={glowPoints}
        color={glowColor}
        lineWidth={6}
        transparent
        opacity={0.25}
      />
      {/* Main border line */}
      <Line
        points={points}
        color={color}
        lineWidth={2}
        transparent
        opacity={0.8}
      />
      {/* Zone label */}
      <Text
        position={[zone.position[0], 1.5, zone.position[2] - zone.size[2] / 2 + 0.5]}
        fontSize={0.5}
        color={color}
        anchorX="center"
        anchorY="middle"
        fillOpacity={0.6}
      >
        {zone.name}
      </Text>
    </group>
  );
}

export function ZoneGroundMarkers({ zones }: ZoneGroundMarkersProps) {
  return (
    <>
      {zones.map((zone) => (
        <ZoneBorder key={zone.id} zone={zone} />
      ))}
    </>
  );
}
