import { create } from "zustand";
import type { SceneConfig, SceneProp } from "@smoothbot/shared";
import type { RefObject } from "react";
import * as THREE from "three";
import { useEnvironmentStore } from "./environment-store";

export interface EditableProp extends SceneProp {
  uid: string;
}

type TransformMode = "translate" | "rotate" | "scale";

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
  toggleSnap: () => void;
  setSnapSize: (n: number) => void;
  undo: () => void;
  redo: () => void;
  saveScene: () => Promise<void>;
  registerPropRef: (uid: string, ref: RefObject<THREE.Group | null>) => void;
  unregisterPropRef: (uid: string) => void;
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
    set({
      active: true,
      sceneId: scene.id,
      editingProps,
      selectedPropUid: null,
      transformMode: "translate",
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

    // Get the current scene to preserve non-prop data
    const currentScene = useEnvironmentStore.getState().getActiveScene();
    const sceneConfig: SceneConfig = {
      ...(currentScene ?? { id: state.sceneId, name: state.sceneId }),
      props,
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
}));
