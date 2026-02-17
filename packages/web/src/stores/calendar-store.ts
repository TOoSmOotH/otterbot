import { create } from "zustand";
import type { CalendarEvent } from "@otterbot/shared";

interface CalendarState {
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  viewMonth: Date;

  loadEvents: (timeMin?: string, timeMax?: string) => Promise<void>;
  createEvent: (data: {
    title: string;
    description?: string;
    location?: string;
    start: string;
    end: string;
    allDay?: boolean;
    source?: string;
  }) => Promise<CalendarEvent | null>;
  deleteEvent: (id: string, source: string) => Promise<boolean>;
  setViewMonth: (date: Date) => void;
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  events: [],
  loading: false,
  error: null,
  viewMonth: new Date(),

  loadEvents: async (timeMin, timeMax) => {
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams();
      if (timeMin) params.set("timeMin", timeMin);
      if (timeMax) params.set("timeMax", timeMax);
      const res = await fetch(`/api/calendar/events?${params}`);
      if (!res.ok) throw new Error("Failed to load events");
      const data = await res.json();
      set({ events: data, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  createEvent: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create event");
      const event = await res.json();
      // Reload events for current month
      const { viewMonth } = get();
      const start = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
      const end = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0, 23, 59, 59);
      await get().loadEvents(start.toISOString(), end.toISOString());
      return event as CalendarEvent;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return null;
    }
  },

  deleteEvent: async (id, source) => {
    try {
      const params = source === "google" ? "?source=google" : "";
      const res = await fetch(`/api/calendar/events/${id}${params}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete event");
      set((s) => ({ events: s.events.filter((e) => e.id !== id) }));
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return false;
    }
  },

  setViewMonth: (date) => set({ viewMonth: date }),
}));
