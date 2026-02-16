import { create } from "zustand";
import type { SceneConfig, SceneProp, Waypoint, WaypointEdge } from "@otterbot/shared";
import type { RefObject } from "react";
import * as THREE from "three";
import { useEnvironmentStore } from "./environment-store";

export interface EditableProp extends SceneProp {
  uid: string;
}

export interface EditableWaypoint extends Waypoint {
  uid: string;
}

export interface EditableEdge extends WaypointEdge {
  uid: string;
}

type TransformMode = "translate" | "rotate" | "scale";
type EditorTool = "props" | "waypoints";
type WaypointTool = "select" | "add" | "connect" | "delete";

interface RoomBuilderState {
  active: boolean;
  sceneId: string | null;
  editingProps: EditableProp[];
  selectedPropUid: string | null;
  transformMode: TransformMode;
  snapEnabled: boolean;
  snapSize: number;
  dirty: boolean;
  saving: boolean;
  dragging: boolean;

  // Editor tool mode
  editorTool: EditorTool;

  // Waypoint editing state
  editingWaypoints: EditableWaypoint[];
  editingEdges: EditableEdge[];
  selectedWaypointId: string | null;
  connectingFromId: string | null;
  waypointTool: WaypointTool;

  // Undo/redo
  history: EditableProp[][];
  future: EditableProp[][];

  // Prop ref registry
  propRefs: Map<string, RefObject<THREE.Group | null>>;

  // Actions
  enterEditMode: (scene: SceneConfig) => void;
  exitEditMode: () => void;
  addProp: (assetRef: string) => void;
  deleteProp: (uid: string) => void;
  selectProp: (uid: string | null) => void;
  updatePropTransform: (uid: string, updates: Partial<Pick<SceneProp, "position" | "rotation" | "scale" | "castShadow" | "receiveShadow">>) => void;
  setTransformMode: (mode: TransformMode) => void;
  setDragging: (dragging: boolean) => void;
  toggleSnap: () => void;
  setSnapSize: (n: number) => void;
  undo: () => void;
  redo: () => void;
  saveScene: () => Promise<void>;
  exportScene: () => void;
  registerPropRef: (uid: string, ref: RefObject<THREE.Group | null>) => void;
  unregisterPropRef: (uid: string) => void;

  // Waypoint actions
  setEditorTool: (tool: EditorTool) => void;
  setWaypointTool: (tool: WaypointTool) => void;
  addWaypoint: (position: [number, number, number]) => void;
  deleteWaypoint: (id: string) => void;
  selectWaypoint: (id: string | null) => void;
  updateWaypointPosition: (id: string, position: [number, number, number]) => void;
  updateWaypointLabel: (id: string, label: string) => void;
  updateWaypointTag: (id: string, tag: string) => void;
  updateWaypointZone: (id: string, zoneId: string | undefined) => void;
  startConnecting: (fromId: string) => void;
  finishConnecting: (toId: string) => void;
  cancelConnecting: () => void;
  deleteEdge: (uid: string) => void;
}

function cloneProps(props: EditableProp[]): EditableProp[] {
  return props.map((p) => ({
    ...p,
    position: [...p.position] as [number, number, number],
    rotation: p.rotation ? ([...p.rotation] as [number, number, number]) : undefined,
    scale: Array.isArray(p.scale) ? ([...p.scale] as [number, number, number]) : p.scale,
  }));
}

function pushHistory(state: RoomBuilderState): Partial<RoomBuilderState> {
  return {
    history: [...state.history, cloneProps(state.editingProps)],
    future: [],
    dirty: true,
  };
}

export const useRoomBuilderStore = create<RoomBuilderState>((set, get) => ({
  active: false,
  sceneId: null,
  editingProps: [],
  selectedPropUid: null,
  transformMode: "translate",
  snapEnabled: false,
  snapSize: 0.5,
  dirty: false,
  saving: false,
  dragging: false,
  editorTool: "props",
  editingWaypoints: [],
  editingEdges: [],
  selectedWaypointId: null,
  connectingFromId: null,
  waypointTool: "select",
  history: [],
  future: [],
  propRefs: new Map(),

  enterEditMode: (scene) => {
    const editingProps: EditableProp[] = scene.props.map((p) => ({
      ...p,
      uid: crypto.randomUUID(),
      position: [...p.position] as [number, number, number],
      rotation: p.rotation ? ([...p.rotation] as [number, number, number]) : undefined,
      scale: Array.isArray(p.scale) ? ([...p.scale] as [number, number, number]) : p.scale,
    }));

    // Load waypoints from scene config
    const editingWaypoints: EditableWaypoint[] = (scene.waypointGraph?.waypoints ?? []).map((wp) => ({
      ...wp,
      uid: crypto.randomUUID(),
      position: [...wp.position] as [number, number, number],
    }));

    const editingEdges: EditableEdge[] = (scene.waypointGraph?.edges ?? []).map((e) => ({
      ...e,
      uid: crypto.randomUUID(),
    }));

    set({
      active: true,
      sceneId: scene.id,
      editingProps,
      selectedPropUid: null,
      transformMode: "translate",
      editorTool: "props",
      editingWaypoints,
      editingEdges,
      selectedWaypointId: null,
      connectingFromId: null,
      waypointTool: "select",
      dirty: false,
      saving: false,
      history: [],
      future: [],
      propRefs: new Map(),
    });
  },

  exitEditMode: () => {
    set({
      active: false,
      sceneId: null,
      editingProps: [],
      selectedPropUid: null,
      editorTool: "props",
      editingWaypoints: [],
      editingEdges: [],
      selectedWaypointId: null,
      connectingFromId: null,
      waypointTool: "select",
      dirty: false,
      saving: false,
      history: [],
      future: [],
      propRefs: new Map(),
    });
  },

  addProp: (assetRef) => {
    const state = get();
    const newProp: EditableProp = {
      uid: crypto.randomUUID(),
      asset: assetRef,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      castShadow: true,
      receiveShadow: true,
    };
    set({
      ...pushHistory(state),
      editingProps: [...state.editingProps, newProp],
      selectedPropUid: newProp.uid,
    });
  },

  deleteProp: (uid) => {
    const state = get();
    set({
      ...pushHistory(state),
      editingProps: state.editingProps.filter((p) => p.uid !== uid),
      selectedPropUid: state.selectedPropUid === uid ? null : state.selectedPropUid,
    });
  },

  selectProp: (uid) => {
    set({ selectedPropUid: uid });
  },

  updatePropTransform: (uid, updates) => {
    const state = get();
    set({
      ...pushHistory(state),
      editingProps: state.editingProps.map((p) =>
        p.uid === uid ? { ...p, ...updates } : p,
      ),
    });
  },

  setTransformMode: (mode) => {
    set({ transformMode: mode });
  },

  setDragging: (dragging) => {
    set({ dragging });
  },

  toggleSnap: () => {
    set((s) => ({ snapEnabled: !s.snapEnabled }));
  },

  setSnapSize: (n) => {
    set({ snapSize: n });
  },

  undo: () => {
    const state = get();
    if (state.history.length === 0) return;
    const previous = state.history[state.history.length - 1];
    set({
      history: state.history.slice(0, -1),
      future: [cloneProps(state.editingProps), ...state.future],
      editingProps: previous,
      dirty: true,
    });
  },

  redo: () => {
    const state = get();
    if (state.future.length === 0) return;
    const next = state.future[0];
    set({
      future: state.future.slice(1),
      history: [...state.history, cloneProps(state.editingProps)],
      editingProps: next,
      dirty: true,
    });
  },

  saveScene: async () => {
    const state = get();
    if (!state.sceneId) return;

    set({ saving: true });

    // Strip UIDs to get clean SceneProps
    const props: SceneProp[] = state.editingProps.map(({ uid, ...rest }) => rest);

    // Build waypoint graph from editing state
    const waypointGraph = state.editingWaypoints.length > 0 ? {
      waypoints: state.editingWaypoints.map(({ uid, ...rest }) => rest),
      edges: state.editingEdges.map(({ uid, ...rest }) => rest),
    } : undefined;

    // Get the current scene to preserve non-prop data
    const currentScene = useEnvironmentStore.getState().getActiveScene();
    const sceneConfig: SceneConfig = {
      ...(currentScene ?? { id: state.sceneId, name: state.sceneId }),
      props,
      ...(waypointGraph ? { waypointGraph } : {}),
    };

    try {
      const res = await fetch(`/api/scenes/${state.sceneId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sceneConfig),
      });
      if (!res.ok) throw new Error("Failed to save scene");

      // Reload environment data
      useEnvironmentStore.getState().reloadEnvironment();

      set({ dirty: false, saving: false });
    } catch (err) {
      console.error("[room-builder] save failed:", err);
      set({ saving: false });
    }
  },

  exportScene: () => {
    const state = get();
    if (!state.sceneId) return;

    // Strip UIDs to get clean SceneProps
    const props: SceneProp[] = state.editingProps.map(({ uid, ...rest }) => rest);

    // Build waypoint graph
    const waypointGraph = state.editingWaypoints.length > 0 ? {
      waypoints: state.editingWaypoints.map(({ uid, ...rest }) => rest),
      edges: state.editingEdges.map(({ uid, ...rest }) => rest),
    } : undefined;

    // Build a full SceneConfig preserving lighting/camera/agentPositions
    const currentScene = useEnvironmentStore.getState().getActiveScene();
    const sceneConfig: SceneConfig = {
      ...(currentScene ?? { id: state.sceneId, name: state.sceneId }),
      props,
      ...(waypointGraph ? { waypointGraph } : {}),
    };

    const json = JSON.stringify(sceneConfig, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.sceneId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  registerPropRef: (uid, ref) => {
    const refs = get().propRefs;
    refs.set(uid, ref);
    set({ propRefs: new Map(refs) });
  },

  unregisterPropRef: (uid) => {
    const refs = get().propRefs;
    refs.delete(uid);
    set({ propRefs: new Map(refs) });
  },

  // Waypoint actions
  setEditorTool: (tool) => {
    set({ editorTool: tool, selectedPropUid: null, selectedWaypointId: null, connectingFromId: null });
  },

  setWaypointTool: (tool) => {
    set({ waypointTool: tool, connectingFromId: null });
  },

  addWaypoint: (position) => {
    const id = `wp-${crypto.randomUUID().slice(0, 8)}`;
    const wp: EditableWaypoint = {
      uid: crypto.randomUUID(),
      id,
      position: [...position] as [number, number, number],
    };
    set((s) => ({
      editingWaypoints: [...s.editingWaypoints, wp],
      selectedWaypointId: id,
      dirty: true,
    }));
  },

  deleteWaypoint: (id) => {
    set((s) => ({
      editingWaypoints: s.editingWaypoints.filter((wp) => wp.id !== id),
      editingEdges: s.editingEdges.filter((e) => e.from !== id && e.to !== id),
      selectedWaypointId: s.selectedWaypointId === id ? null : s.selectedWaypointId,
      dirty: true,
    }));
  },

  selectWaypoint: (id) => {
    set({ selectedWaypointId: id });
  },

  updateWaypointPosition: (id, position) => {
    set((s) => ({
      editingWaypoints: s.editingWaypoints.map((wp) =>
        wp.id === id ? { ...wp, position: [...position] as [number, number, number] } : wp,
      ),
      dirty: true,
    }));
  },

  updateWaypointLabel: (id, label) => {
    set((s) => ({
      editingWaypoints: s.editingWaypoints.map((wp) =>
        wp.id === id ? { ...wp, label: label || undefined } : wp,
      ),
      dirty: true,
    }));
  },

  updateWaypointTag: (id, tag) => {
    set((s) => ({
      editingWaypoints: s.editingWaypoints.map((wp) =>
        wp.id === id ? { ...wp, tag: tag || undefined } : wp,
      ),
      dirty: true,
    }));
  },

  updateWaypointZone: (id, zoneId) => {
    set((s) => ({
      editingWaypoints: s.editingWaypoints.map((wp) =>
        wp.id === id ? { ...wp, zoneId } : wp,
      ),
      dirty: true,
    }));
  },

  startConnecting: (fromId) => {
    set({ connectingFromId: fromId });
  },

  finishConnecting: (toId) => {
    const { connectingFromId, editingEdges } = get();
    if (!connectingFromId || connectingFromId === toId) {
      set({ connectingFromId: null });
      return;
    }

    // Check if edge already exists
    const exists = editingEdges.some(
      (e) => (e.from === connectingFromId && e.to === toId) || (e.from === toId && e.to === connectingFromId),
    );

    if (!exists) {
      const edge: EditableEdge = {
        uid: crypto.randomUUID(),
        from: connectingFromId,
        to: toId,
      };
      set((s) => ({
        editingEdges: [...s.editingEdges, edge],
        connectingFromId: null,
        dirty: true,
      }));
    } else {
      set({ connectingFromId: null });
    }
  },

  cancelConnecting: () => {
    set({ connectingFromId: null });
  },

  deleteEdge: (uid) => {
    set((s) => ({
      editingEdges: s.editingEdges.filter((e) => e.uid !== uid),
      dirty: true,
    }));
  },
}));
