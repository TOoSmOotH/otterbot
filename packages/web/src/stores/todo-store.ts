import { create } from "zustand";
import type { Todo } from "@otterbot/shared";

interface TodoState {
  todos: Todo[];
  loading: boolean;
  error: string | null;

  loadTodos: (filters?: { status?: string; priority?: string }) => Promise<void>;
  createTodo: (data: {
    title: string;
    description?: string;
    priority?: string;
    dueDate?: string;
    tags?: string[];
  }) => Promise<Todo | null>;
  updateTodo: (
    id: string,
    data: {
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      dueDate?: string | null;
      tags?: string[];
    },
  ) => Promise<Todo | null>;
  deleteTodo: (id: string) => Promise<boolean>;
}

export const useTodoStore = create<TodoState>((set, get) => ({
  todos: [],
  loading: false,
  error: null,

  loadTodos: async (filters) => {
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.priority) params.set("priority", filters.priority);
      const qs = params.toString();
      const res = await fetch(`/api/todos${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to load todos");
      const data = await res.json();
      set({ todos: data, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  createTodo: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create todo");
      const todo = await res.json();
      await get().loadTodos();
      return todo as Todo;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return null;
    }
  },

  updateTodo: async (id, data) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/todos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update todo");
      const todo = await res.json();
      await get().loadTodos();
      return todo as Todo;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return null;
    }
  },

  deleteTodo: async (id) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/todos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete todo");
      await get().loadTodos();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return false;
    }
  },
}));
