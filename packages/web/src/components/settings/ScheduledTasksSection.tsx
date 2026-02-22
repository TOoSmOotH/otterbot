import { useEffect, useState, useRef } from "react";
import { useSettingsStore, type ScheduledTaskInfo, type CustomTaskInfo } from "../../stores/settings-store";

function formatInterval(ms: number): { value: number; unit: string; unitMs: number } {
  if (ms >= 3_600_000) {
    return { value: ms / 3_600_000, unit: "hours", unitMs: 3_600_000 };
  }
  if (ms >= 60_000) {
    return { value: ms / 60_000, unit: "minutes", unitMs: 60_000 };
  }
  return { value: ms / 1_000, unit: "seconds", unitMs: 1_000 };
}

const UNIT_OPTIONS = [
  { label: "seconds", ms: 1_000 },
  { label: "minutes", ms: 60_000 },
  { label: "hours", ms: 3_600_000 },
];

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

// ---------------------------------------------------------------------------
// Custom Task Form (inline)
// ---------------------------------------------------------------------------

interface CustomTaskFormData {
  name: string;
  description: string;
  message: string;
  mode: "coo-prompt" | "coo-background" | "notification";
  intervalValue: string;
  intervalUnit: number; // ms per unit
}

const EMPTY_FORM: CustomTaskFormData = {
  name: "",
  description: "",
  message: "",
  mode: "notification",
  intervalValue: "5",
  intervalUnit: 60_000,
};

function CustomTaskForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: CustomTaskFormData;
  onSubmit: (data: CustomTaskFormData) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [form, setForm] = useState<CustomTaskFormData>(initial ?? EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.message.trim()) return;
    const num = parseFloat(form.intervalValue);
    if (isNaN(num) || num <= 0) return;
    setSaving(true);
    await onSubmit(form);
    setSaving(false);
  };

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="space-y-2">
        <input
          type="text"
          placeholder="Task name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full bg-secondary rounded-md px-2 py-1.5 text-xs outline-none focus:ring-1 ring-primary"
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full bg-secondary rounded-md px-2 py-1.5 text-xs outline-none focus:ring-1 ring-primary"
        />
        <textarea
          placeholder="Message to send"
          rows={3}
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          className="w-full bg-secondary rounded-md px-2 py-1.5 text-xs outline-none focus:ring-1 ring-primary resize-none"
        />
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider whitespace-nowrap">
            Mode
          </label>
          <select
            value={form.mode}
            onChange={(e) => setForm({ ...form, mode: e.target.value as "coo-prompt" | "coo-background" | "notification" })}
            className="bg-secondary rounded-md px-2 py-1 text-xs outline-none focus:ring-1 ring-primary"
          >
            <option value="coo-prompt">Send to COO</option>
            <option value="coo-background">Background check</option>
            <option value="notification">Notification only</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider whitespace-nowrap">
            Every
          </label>
          <input
            type="number"
            min={1}
            step="any"
            value={form.intervalValue}
            onChange={(e) => setForm({ ...form, intervalValue: e.target.value })}
            className="w-16 bg-secondary rounded-md px-2 py-1 text-xs outline-none focus:ring-1 ring-primary"
          />
          <select
            value={form.intervalUnit}
            onChange={(e) => setForm({ ...form, intervalUnit: Number(e.target.value) })}
            className="bg-secondary rounded-md px-2 py-1 text-xs outline-none focus:ring-1 ring-primary"
          >
            {UNIT_OPTIONS.map((u) => (
              <option key={u.ms} value={u.ms}>{u.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={saving || !form.name.trim() || !form.message.trim()}
          className="px-3 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving..." : submitLabel}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs rounded-md bg-secondary hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Task Card
// ---------------------------------------------------------------------------

function CustomTaskCard({ task }: { task: CustomTaskInfo }) {
  const { updateCustomTask, deleteCustomTask } = useSettingsStore();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const formatted = formatInterval(task.intervalMs);

  const handleToggle = async () => {
    await updateCustomTask(task.id, { enabled: !task.enabled });
  };

  const handleDelete = async () => {
    setDeleting(true);
    await deleteCustomTask(task.id);
    setDeleting(false);
  };

  if (editing) {
    return (
      <CustomTaskForm
        initial={{
          name: task.name,
          description: task.description,
          message: task.message,
          mode: task.mode,
          intervalValue: String(formatted.value),
          intervalUnit: formatted.unitMs,
        }}
        submitLabel="Save"
        onCancel={() => setEditing(false)}
        onSubmit={async (form) => {
          const num = parseFloat(form.intervalValue);
          await updateCustomTask(task.id, {
            name: form.name,
            description: form.description,
            message: form.message,
            mode: form.mode,
            intervalMs: Math.round(num * form.intervalUnit),
          });
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${task.enabled ? "bg-green-500" : "bg-gray-500"}`}
          />
          <span className="text-xs font-medium">{task.name}</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
            task.mode === "coo-prompt"
              ? "bg-blue-500/20 text-blue-400"
              : task.mode === "coo-background"
                ? "bg-purple-500/20 text-purple-400"
                : "bg-amber-500/20 text-amber-400"
          }`}>
            {task.mode === "coo-prompt" ? "COO Prompt" : task.mode === "coo-background" ? "Background Check" : "Notification"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditing(true)}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Edit
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-50"
          >
            {deleting ? "..." : "Delete"}
          </button>
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
      </div>

      {task.description && (
        <p className="text-[10px] text-muted-foreground">{task.description}</p>
      )}

      <p className="text-[10px] text-muted-foreground italic line-clamp-2">
        &ldquo;{task.message}&rdquo;
      </p>

      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>Every {formatted.value} {formatted.unit}</span>
        {task.lastRunAt && (
          <span>Last run: {new Date(task.lastRunAt).toLocaleString()}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Section
// ---------------------------------------------------------------------------

export function ScheduledTasksSection() {
  const {
    scheduledTasks, scheduledTasksLoading, loadScheduledTasks,
    customTasks, customTasksLoading, loadCustomTasks,
    createCustomTask,
  } = useSettingsStore();
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadScheduledTasks();
    loadCustomTasks();
  }, []);

  return (
    <div className="p-5 space-y-6">
      {/* Built-in schedulers */}
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

      {/* Custom tasks */}
      <div className="border-t border-border pt-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-xs font-semibold mb-1">Custom Tasks</h3>
            <p className="text-xs text-muted-foreground">
              User-defined tasks that fire on a recurring interval.
            </p>
          </div>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="px-3 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:opacity-90"
            >
              Add Task
            </button>
          )}
        </div>

        {showForm && (
          <div className="mb-3">
            <CustomTaskForm
              submitLabel="Create"
              onCancel={() => setShowForm(false)}
              onSubmit={async (form) => {
                const num = parseFloat(form.intervalValue);
                await createCustomTask({
                  name: form.name,
                  description: form.description,
                  message: form.message,
                  mode: form.mode,
                  intervalMs: Math.round(num * form.intervalUnit),
                });
                setShowForm(false);
              }}
            />
          </div>
        )}

        {customTasksLoading && customTasks.length === 0 ? (
          <div className="text-xs text-muted-foreground">Loading...</div>
        ) : customTasks.length === 0 && !showForm ? (
          <div className="rounded-lg border border-border p-6 bg-secondary flex flex-col items-center justify-center text-center">
            <p className="text-xs text-muted-foreground">
              No custom tasks yet. Click &ldquo;Add Task&rdquo; to create one.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {customTasks.map((task) => (
              <CustomTaskCard key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
