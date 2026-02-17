import { useEffect, useState, useMemo } from "react";
import { useCalendarStore } from "../../stores/calendar-store";
import type { CalendarEvent } from "@otterbot/shared";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarView() {
  const events = useCalendarStore((s) => s.events);
  const loading = useCalendarStore((s) => s.loading);
  const loadEvents = useCalendarStore((s) => s.loadEvents);
  const createEvent = useCalendarStore((s) => s.createEvent);
  const deleteEvent = useCalendarStore((s) => s.deleteEvent);
  const viewMonth = useCalendarStore((s) => s.viewMonth);
  const setViewMonth = useCalendarStore((s) => s.setViewMonth);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newAllDay, setNewAllDay] = useState(false);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();

  useEffect(() => {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0, 23, 59, 59);
    loadEvents(start.toISOString(), end.toISOString());
  }, [year, month]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = [];

    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);

    return days;
  }, [year, month]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const dateKey = event.start.slice(0, 10);
      const existing = map.get(dateKey) ?? [];
      existing.push(event);
      map.set(dateKey, existing);
    }
    return map;
  }, [events]);

  const navigateMonth = (delta: number) => {
    setViewMonth(new Date(year, month + delta, 1));
    setSelectedDate(null);
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    const startStr = newAllDay
      ? `${selectedDate}T00:00:00`
      : newStart || `${selectedDate}T09:00:00`;
    const endStr = newAllDay
      ? `${selectedDate}T23:59:59`
      : newEnd || `${selectedDate}T10:00:00`;

    await createEvent({
      title: newTitle.trim(),
      start: startStr,
      end: endStr,
      allDay: newAllDay,
    });
    setNewTitle("");
    setNewStart("");
    setNewEnd("");
    setNewAllDay(false);
    setShowCreate(false);
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const selectedDateEvents = selectedDate ? (eventsByDate.get(selectedDate) ?? []) : [];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateMonth(-1)}
            className="text-muted-foreground hover:text-foreground px-1.5"
          >
            &larr;
          </button>
          <h2 className="text-sm font-semibold min-w-[140px] text-center">
            {new Date(year, month).toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })}
          </h2>
          <button
            onClick={() => navigateMonth(1)}
            className="text-muted-foreground hover:text-foreground px-1.5"
          >
            &rarr;
          </button>
        </div>
        <button
          onClick={() => {
            setViewMonth(new Date());
            setSelectedDate(todayStr);
          }}
          className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-secondary"
        >
          Today
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Calendar grid */}
        <div className="flex-1 flex flex-col p-2">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-px mb-1">
            {DAYS.map((d) => (
              <div
                key={d}
                className="text-[9px] text-muted-foreground text-center py-1 font-medium"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-px flex-1">
            {calendarDays.map((day, i) => {
              if (day === null) {
                return <div key={`empty-${i}`} className="bg-secondary/20 rounded-sm" />;
              }
              const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const dayEvents = eventsByDate.get(dateStr) ?? [];
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selectedDate;

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(dateStr)}
                  className={`rounded-sm p-1 text-left transition-colors min-h-[48px] ${
                    isSelected
                      ? "bg-primary/20 ring-1 ring-primary"
                      : isToday
                        ? "bg-primary/10"
                        : "hover:bg-secondary/50"
                  }`}
                >
                  <span
                    className={`text-[10px] ${
                      isToday ? "text-primary font-bold" : "text-foreground"
                    }`}
                  >
                    {day}
                  </span>
                  <div className="mt-0.5 space-y-0.5">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <div
                        key={ev.id}
                        className={`text-[8px] truncate px-1 py-0.5 rounded ${
                          ev.source === "google"
                            ? "bg-blue-500/20 text-blue-300"
                            : "bg-green-500/20 text-green-300"
                        }`}
                      >
                        {ev.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[8px] text-muted-foreground px-1">
                        +{dayEvents.length - 3} more
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Side panel: day detail */}
        {selectedDate && (
          <div className="w-72 border-l border-border overflow-y-auto p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold">
                {new Date(selectedDate + "T12:00:00").toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </h3>
              <button
                onClick={() => setShowCreate(!showCreate)}
                className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded hover:bg-primary/90"
              >
                + Event
              </button>
            </div>

            {/* Create form */}
            {showCreate && (
              <div className="space-y-2 border border-border rounded p-2 bg-secondary/30">
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  placeholder="Event title"
                  className="w-full bg-secondary rounded px-2 py-1 text-[10px] outline-none focus:ring-1 ring-primary"
                  autoFocus
                />
                <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={newAllDay}
                    onChange={(e) => setNewAllDay(e.target.checked)}
                    className="w-3 h-3"
                  />
                  All day
                </label>
                {!newAllDay && (
                  <div className="flex items-center gap-1">
                    <input
                      type="time"
                      value={newStart}
                      onChange={(e) => setNewStart(e.target.value)}
                      className="flex-1 bg-secondary rounded px-2 py-1 text-[10px] outline-none"
                    />
                    <span className="text-[10px] text-muted-foreground">to</span>
                    <input
                      type="time"
                      value={newEnd}
                      onChange={(e) => setNewEnd(e.target.value)}
                      className="flex-1 bg-secondary rounded px-2 py-1 text-[10px] outline-none"
                    />
                  </div>
                )}
                <div className="flex gap-1">
                  <button
                    onClick={handleCreate}
                    disabled={!newTitle.trim()}
                    className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded disabled:opacity-50"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => setShowCreate(false)}
                    className="text-[10px] text-muted-foreground px-2 py-0.5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Events list */}
            {selectedDateEvents.length === 0 && !showCreate && (
              <p className="text-[10px] text-muted-foreground">No events on this day.</p>
            )}

            {selectedDateEvents.map((ev) => (
              <div
                key={ev.id}
                className={`group border rounded p-2 space-y-1 ${
                  ev.source === "google" ? "border-blue-500/30" : "border-green-500/30"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{ev.title}</span>
                  <span
                    className={`text-[8px] px-1 py-0.5 rounded ${
                      ev.source === "google"
                        ? "bg-blue-500/20 text-blue-300"
                        : "bg-green-500/20 text-green-300"
                    }`}
                  >
                    {ev.source}
                  </span>
                </div>
                {ev.allDay ? (
                  <div className="text-[10px] text-muted-foreground">All day</div>
                ) : (
                  <div className="text-[10px] text-muted-foreground">
                    {formatTime(ev.start)} - {formatTime(ev.end)}
                  </div>
                )}
                {ev.location && (
                  <div className="text-[10px] text-muted-foreground">{ev.location}</div>
                )}
                {ev.description && (
                  <div className="text-[10px] text-muted-foreground truncate">{ev.description}</div>
                )}
                <button
                  onClick={() => deleteEvent(ev.id, ev.source)}
                  className="text-[9px] text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
