import { useEffect } from "react";
import { useRoomBuilderStore } from "../stores/room-builder-store";

export function useRoomBuilderKeys() {
  const active = useRoomBuilderStore((s) => s.active);

  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const state = useRoomBuilderStore.getState();

      if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        state.setTransformMode("translate");
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        state.setTransformMode("rotate");
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        state.setTransformMode("scale");
      } else if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        state.toggleSnap();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (state.selectedPropUid) {
          e.preventDefault();
          state.deleteProp(state.selectedPropUid);
        }
      } else if (e.key === "Escape") {
        if (state.selectedPropUid) {
          state.selectProp(null);
        } else if (!state.dirty || window.confirm("Discard unsaved changes?")) {
          state.exitEditMode();
        }
      } else if (e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        state.redo();
      } else if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        state.undo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active]);
}
