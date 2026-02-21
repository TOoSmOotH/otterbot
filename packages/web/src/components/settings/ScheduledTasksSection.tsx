import { useEffect, useState, useRef } from "react";
import { useSettingsStore, type ScheduledTaskInfo } from "../../stores/settings-store";

function formatInterval(ms: number): { value: number; unit: string; unitMs: number } {
  if (ms >= 3_600_000) {
    return { value: ms / 3_600_000, unit: "hours", unitMs: 3_600_000 };
  }
  if (ms >= 60_000) {
    return { value: ms / 60_000, unit: "minutes", unitMs: 60_000 };
  }
  return { value: ms / 1_000, unit: "seconds", unitMs: 1_000 };
}

function TaskCard({ task }: { task: ScheduledTaskInfo }) {
  const { updateScheduledTask } = useSettingsStore();

  const formatted = formatInterval(task.intervalMs);
  const defaultFormatted = formatInterval(task.defaultIntervalMs);
  const [intervalValue, setIntervalValue] = useState(String(formatted.value));
  const savingRef = useRef(false);

  useEffect(() => {
    const f = formatInterval(task.intervalMs);
    setIntervalValue(String(f.value));
  }, [task.intervalMs]);

  const handleToggle = async () => {
    await updateScheduledTask(task.id, { enabled: !task.enabled });
  };

  const handleIntervalBlur = async () => {
    const num = parseFloat(intervalValue);
    if (isNaN(num) || num <= 0) {
      setIntervalValue(String(formatted.value));
      return;
    }
    const newMs = Math.round(num * formatted.unitMs);
    if (newMs === task.intervalMs) return;
    if (savingRef.current) return;
    savingRef.current = true;
    await updateScheduledTask(task.id, { intervalMs: newMs });
    savingRef.current = false;
  };

  const handleReset = async () => {
    await updateScheduledTask(task.id, { intervalMs: task.defaultIntervalMs });
  };

  const isDefault = task.intervalMs === task.defaultIntervalMs;

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${task.enabled ? "bg-green-500" : "bg-gray-500"}`}
          />
          <span className="text-xs font-medium">{task.name}</span>
        </div>
        <button
          onClick={handleToggle}
          className={`relative w-8 h-4 rounded-full transition-colors ${
            task.enabled ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
              task.enabled ? "translate-x-4" : ""
            }`}
          />
        </button>
      </div>

      <p className="text-[10px] text-muted-foreground">{task.description}</p>

      <div className="flex items-center gap-2">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider whitespace-nowrap">
          Interval
        </label>
        <input
          type="number"
          min={0}
          step="any"
          value={intervalValue}
          onChange={(e) => setIntervalValue(e.target.value)}
          onBlur={handleIntervalBlur}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          disabled={!task.enabled}
          className="w-20 bg-secondary rounded-md px-2 py-1 text-xs outline-none focus:ring-1 ring-primary disabled:opacity-50"
        />
        <span className="text-[10px] text-muted-foreground">{formatted.unit}</span>
        {!isDefault && (
          <button
            onClick={handleReset}
            className="text-[10px] text-primary hover:underline ml-auto"
          >
            Reset to default ({defaultFormatted.value} {defaultFormatted.unit})
          </button>
        )}
      </div>
    </div>
  );
}

export function ScheduledTasksSection() {
  const { scheduledTasks, scheduledTasksLoading, loadScheduledTasks } = useSettingsStore();

  useEffect(() => {
    loadScheduledTasks();
  }, []);

  return (
    <div className="p-5 space-y-4">
      <div>
        <h3 className="text-xs font-semibold mb-1">Scheduled Tasks</h3>
        <p className="text-xs text-muted-foreground">
          Configure background schedulers that run automatically.
        </p>
      </div>

      {scheduledTasksLoading && scheduledTasks.length === 0 ? (
        <div className="text-xs text-muted-foreground">Loading...</div>
      ) : scheduledTasks.length === 0 ? (
        <div className="rounded-lg border border-border p-6 bg-secondary flex flex-col items-center justify-center text-center">
          <p className="text-xs text-muted-foreground">
            No schedulers registered. They will appear here once the server starts.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {scheduledTasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
