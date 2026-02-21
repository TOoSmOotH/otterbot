import { create } from "zustand";
import type { Todo } from "@otterbot/shared";

interface TodoState {
  todos: Todo[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  filterPriority: string;

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

  // Socket-driven state updaters
  addTodo: (todo: Todo) => void;
  patchTodo: (todo: Todo) => void;
  removeTodo: (todoId: string) => void;

  setSearchQuery: (query: string) => void;
  setFilterPriority: (priority: string) => void;
}

export const useTodoStore = create<TodoState>((set, get) => ({
  todos: [],
  loading: false,
  error: null,
  searchQuery: "",
  filterPriority: "",

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
      // Socket event will handle state update via addTodo
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
      // Socket event will handle state update via patchTodo
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
      // Socket event will handle state update via removeTodo
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return false;
    }
  },

  addTodo: (todo) => {
    set((state) => {
      if (state.todos.some((t) => t.id === todo.id)) return state;
      return { todos: [...state.todos, todo] };
    });
  },

  patchTodo: (todo) => {
    set((state) => ({
      todos: state.todos.map((t) => (t.id === todo.id ? todo : t)),
    }));
  },

  removeTodo: (todoId) => {
    set((state) => ({
      todos: state.todos.filter((t) => t.id !== todoId),
    }));
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilterPriority: (priority) => set({ filterPriority: priority }),
}));
