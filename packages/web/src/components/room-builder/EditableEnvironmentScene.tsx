import { Suspense, useMemo, useRef, useEffect, useCallback } from "react";
import { useGLTF, TransformControls } from "@react-three/drei";
import * as THREE from "three";
import { useEnvironmentStore } from "../../stores/environment-store";
import { useRoomBuilderStore, type EditableProp } from "../../stores/room-builder-store";
import { WaypointEditor } from "./WaypointEditor";

export function EditableEnvironmentScene() {
  const editingProps = useRoomBuilderStore((s) => s.editingProps);
  const selectedPropUid = useRoomBuilderStore((s) => s.selectedPropUid);
  const transformMode = useRoomBuilderStore((s) => s.transformMode);
  const snapEnabled = useRoomBuilderStore((s) => s.snapEnabled);
  const snapSize = useRoomBuilderStore((s) => s.snapSize);
  const selectProp = useRoomBuilderStore((s) => s.selectProp);
  const propRefs = useRoomBuilderStore((s) => s.propRefs);
  const resolveAssetUrl = useEnvironmentStore((s) => s.resolveAssetUrl);
  const editorTool = useRoomBuilderStore((s) => s.editorTool);

  // Deduplicate URLs for preloading
  const uniqueUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const prop of editingProps) {
      const url = resolveAssetUrl(prop.asset);
      if (url) urls.add(url);
    }
    return [...urls];
  }, [editingProps, resolveAssetUrl]);

  for (const url of uniqueUrls) {
    useGLTF.preload(url);
  }

  const selectedRef = selectedPropUid ? propRefs.get(selectedPropUid) : null;

  return (
    <group>
      {editingProps.map((prop) => {
        const url = resolveAssetUrl(prop.asset);
        if (!url) return null;
        return (
          <Suspense key={prop.uid} fallback={null}>
            <EditablePropModel
              url={url}
              prop={prop}
              selected={prop.uid === selectedPropUid}
              onSelect={() => selectProp(prop.uid)}
            />
          </Suspense>
        );
      })}

      {/* TransformControls for selected prop */}
      {selectedPropUid && selectedRef?.current && (
        <TransformGizmo
          target={selectedRef.current}
          mode={transformMode}
          snapEnabled={snapEnabled}
          snapSize={snapSize}
          propUid={selectedPropUid}
        />
      )}

      {/* Grid helper when snapping enabled */}
      {snapEnabled && (
        <gridHelper args={[100, 100 / snapSize, "#333355", "#222244"]} position={[0, 0.01, 0]} />
      )}

      {/* Waypoint editor overlay */}
      {editorTool === "waypoints" && <WaypointEditor />}

      {/* Invisible floor plane for raycasting */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        visible={false}
        onPointerDown={(e) => {
          if (useRoomBuilderStore.getState().dragging) return;
          if (e.eventObject === e.object) {
            selectProp(null);
          }
        }}
      >
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial />
      </mesh>
    </group>
  );
}

function TransformGizmo({
  target,
  mode,
  snapEnabled,
  snapSize,
  propUid,
}: {
  target: THREE.Group;
  mode: "translate" | "rotate" | "scale";
  snapEnabled: boolean;
  snapSize: number;
  propUid: string;
}) {
  const updatePropTransform = useRoomBuilderStore((s) => s.updatePropTransform);
  const setDragging = useRoomBuilderStore((s) => s.setDragging);
  const controlsRef = useRef<any>(null);

  const syncTransform = useCallback(() => {
    if (!target) return;
    const pos = target.position;
    const rot = target.rotation;
    const scl = target.scale;
    updatePropTransform(propUid, {
      position: [pos.x, pos.y, pos.z],
      rotation: [rot.x, rot.y, rot.z],
      scale: scl.x === scl.y && scl.y === scl.z
        ? scl.x
        : [scl.x, scl.y, scl.z],
    });
  }, [target, propUid, updatePropTransform]);

  // Listen for dragging-changed on the underlying THREE.TransformControls
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const onDraggingChanged = (event: { value: boolean }) => {
      setDragging(event.value);
      // Sync transform back to store when drag ends
      if (!event.value) {
        syncTransform();
      }
    };

    controls.addEventListener("dragging-changed", onDraggingChanged);
    return () => {
      controls.removeEventListener("dragging-changed", onDraggingChanged);
      setDragging(false);
    };
  }, [setDragging, syncTransform]);

  return (
    <TransformControls
      ref={controlsRef}
      object={target}
      mode={mode}
      translationSnap={snapEnabled ? snapSize : undefined}
      rotationSnap={snapEnabled ? Math.PI / 12 : undefined}
      scaleSnap={snapEnabled ? 0.1 : undefined}
    />
  );
}

function EditablePropModel({
  url,
  prop,
  selected,
  onSelect,
}: {
  url: string;
  prop: EditableProp;
  selected: boolean;
  onSelect: () => void;
}) {
  const { scene } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);
  const registerPropRef = useRoomBuilderStore((s) => s.registerPropRef);
  const unregisterPropRef = useRoomBuilderStore((s) => s.unregisterPropRef);

  useEffect(() => {
    if (groupRef.current) {
      registerPropRef(prop.uid, groupRef);
    }
    return () => {
      unregisterPropRef(prop.uid);
    };
  }, [prop.uid, registerPropRef, unregisterPropRef]);

  const clone = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (prop.castShadow) child.castShadow = true;
        if (prop.receiveShadow) child.receiveShadow = true;
      }
    });
    return c;
  }, [scene, prop.castShadow, prop.receiveShadow]);

  const scale = useMemo(() => {
    if (!prop.scale) return [1, 1, 1] as [number, number, number];
    if (typeof prop.scale === "number")
      return [prop.scale, prop.scale, prop.scale] as [number, number, number];
    return prop.scale;
  }, [prop.scale]);

  return (
    <group
      ref={groupRef}
      position={prop.position}
      rotation={prop.rotation ?? [0, 0, 0]}
      scale={scale}
      onPointerDown={(e) => {
        // Skip selection if TransformControls is being dragged
        if (useRoomBuilderStore.getState().dragging) return;
        e.stopPropagation();
        onSelect();
      }}
    >
      <primitive object={clone} />
      {selected && <SelectionHighlight target={clone} />}
    </group>
  );
}

function SelectionHighlight({ target }: { target: THREE.Object3D }) {
  const box = useMemo(() => {
    const b = new THREE.Box3().setFromObject(target);
    return b;
  }, [target]);

  const size = useMemo(() => {
    const s = new THREE.Vector3();
    box.getSize(s);
    return s;
  }, [box]);

  const center = useMemo(() => {
    const c = new THREE.Vector3();
    box.getCenter(c);
    return c;
  }, [box]);

  return (
    <mesh position={[center.x, center.y, center.z]}>
      <boxGeometry args={[size.x + 0.05, size.y + 0.05, size.z + 0.05]} />
      <meshBasicMaterial color="#4488ff" wireframe transparent opacity={0.4} />
    </mesh>
  );
}
