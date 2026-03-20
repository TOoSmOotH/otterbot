/**
 * Shared fetch/CRUD helpers for studio stores.
 * Each store (game, app, video) calls these internally while exposing
 * its own entity-specific property names for backward compatibility.
 */

export interface StudioStoreConfig {
  /** REST API base path, e.g. "/api/games" */
  apiPath: string;
  /** Template endpoint path, e.g. "/api/game-templates". Omit if no templates. */
  templatePath?: string;
}

export function createLoadItems<T>(
  config: StudioStoreConfig,
  set: (partial: Record<string, unknown>) => void,
  itemsKey: string,
) {
  return async (projectId?: string) => {
    set({ loading: true, error: null });
    try {
      const qs = projectId ? `?projectId=${projectId}` : "";
      const res = await fetch(`${config.apiPath}${qs}`);
      if (!res.ok) throw new Error(`Failed to load`);
      const data: T[] = await res.json();
      set({ [itemsKey]: data, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };
}

export function createLoadTemplates(
  config: StudioStoreConfig,
  set: (partial: Record<string, unknown>) => void,
) {
  return async () => {
    if (!config.templatePath) return;
    try {
      const res = await fetch(config.templatePath);
      if (!res.ok) throw new Error("Failed to load templates");
      const data = await res.json();
      set({ templates: data });
    } catch (err) {
      console.warn("Failed to load templates:", err);
    }
  };
}

export function createDeleteItem(
  config: StudioStoreConfig,
  set: (partial: Record<string, unknown>) => void,
) {
  return async (projectId: string, itemId: string) => {
    try {
      const res = await fetch(`${config.apiPath}/${projectId}/${itemId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return false;
    }
  };
}

export function createAddItem<T extends { id: string }>(
  itemsKey: string,
) {
  return (item: T, state: Record<string, unknown>) => {
    const items = state[itemsKey] as T[];
    if (items.some((i) => i.id === item.id)) return state;
    return { [itemsKey]: [...items, item] };
  };
}

export function createUpdateItem<T extends { id: string }>(
  itemsKey: string,
) {
  return (item: T, state: Record<string, unknown>) => ({
    [itemsKey]: (state[itemsKey] as T[]).map((i) => (i.id === item.id ? item : i)),
  });
}

export function createRemoveItem<T extends { id: string }>(
  itemsKey: string,
  selectedIdKey: string,
) {
  return (itemId: string, state: Record<string, unknown>) => ({
    [itemsKey]: (state[itemsKey] as T[]).filter((i) => i.id !== itemId),
    [selectedIdKey]:
      state[selectedIdKey] === itemId ? null : state[selectedIdKey],
  });
}
