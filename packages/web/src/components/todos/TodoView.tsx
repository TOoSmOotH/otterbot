import { useEffect, useState } from "react";
import { useTodoStore } from "../../stores/todo-store";
import type { Todo } from "@otterbot/shared";

const STATUS_LABELS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "text-red-400 bg-red-500/10",
  medium: "text-yellow-400 bg-yellow-500/10",
  low: "text-blue-400 bg-blue-500/10",
};

export function TodoView() {
  const todos = useTodoStore((s) => s.todos);
  const loading = useTodoStore((s) => s.loading);
  const loadTodos = useTodoStore((s) => s.loadTodos);
  const createTodo = useTodoStore((s) => s.createTodo);
  const updateTodo = useTodoStore((s) => s.updateTodo);
  const deleteTodo = useTodoStore((s) => s.deleteTodo);

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState("medium");
  const [newDueDate, setNewDueDate] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("");

  useEffect(() => {
    loadTodos();
  }, []);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    await createTodo({
      title: newTitle.trim(),
      priority: newPriority,
      dueDate: newDueDate || undefined,
    });
    setNewTitle("");
    setNewPriority("medium");
    setNewDueDate("");
    setShowCreate(false);
  };

  const handleStatusCycle = async (todo: Todo) => {
    const next: Record<string, string> = {
      todo: "in_progress",
      in_progress: "done",
      done: "todo",
    };
    await updateTodo(todo.id, { status: next[todo.status] });
  };

  const grouped = {
    todo: todos.filter((t) => !filterStatus || t.status === filterStatus).filter((t) => t.status === "todo"),
    in_progress: todos.filter((t) => !filterStatus || t.status === filterStatus).filter((t) => t.status === "in_progress"),
    done: todos.filter((t) => !filterStatus || t.status === filterStatus).filter((t) => t.status === "done"),
  };

  const filteredGroups = filterStatus
    ? { [filterStatus]: grouped[filterStatus as keyof typeof grouped] }
    : grouped;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">Todos</h2>
          <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
            {todos.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-[10px] bg-secondary border-none rounded px-2 py-1 text-foreground outline-none"
          >
            <option value="">All</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
          </select>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="text-xs bg-primary text-primary-foreground px-2.5 py-1 rounded hover:bg-primary/90"
          >
            + New
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="px-4 py-3 border-b border-border bg-secondary/30 space-y-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="What needs to be done?"
            className="w-full bg-secondary rounded px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value)}
              className="text-[10px] bg-secondary rounded px-2 py-1 outline-none"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <input
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              className="text-[10px] bg-secondary rounded px-2 py-1 outline-none"
            />
            <button
              onClick={handleCreate}
              disabled={!newTitle.trim()}
              className="text-[10px] bg-primary text-primary-foreground px-2 py-1 rounded hover:bg-primary/90 disabled:opacity-50"
            >
              Add
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Todo list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {loading && todos.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-8">Loading...</div>
        )}

        {!loading && todos.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-8">
            No todos yet. Click "+ New" to create one.
          </div>
        )}

        {Object.entries(filteredGroups).map(([status, items]) => {
          if (!items || items.length === 0) return null;
          return (
            <div key={status}>
              <h3 className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                {STATUS_LABELS[status] ?? status} ({items.length})
              </h3>
              <div className="space-y-1">
                {items.map((todo) => (
                  <TodoItem
                    key={todo.id}
                    todo={todo}
                    onStatusCycle={() => handleStatusCycle(todo)}
                    onDelete={() => deleteTodo(todo.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TodoItem({
  todo,
  onStatusCycle,
  onDelete,
}: {
  todo: Todo;
  onStatusCycle: () => void;
  onDelete: () => void;
}) {
  const isDone = todo.status === "done";

  return (
    <div
      className={`group flex items-start gap-2.5 px-3 py-2 rounded-md border border-border hover:bg-secondary/50 transition-colors ${
        isDone ? "opacity-50" : ""
      }`}
    >
      {/* Status checkbox */}
      <button
        onClick={onStatusCycle}
        className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
          isDone
            ? "bg-primary border-primary"
            : todo.status === "in_progress"
              ? "border-yellow-400 bg-yellow-400/20"
              : "border-muted-foreground hover:border-primary"
        }`}
        title={`Click to change status (current: ${STATUS_LABELS[todo.status]})`}
      >
        {isDone && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        {todo.status === "in_progress" && (
          <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className={`text-xs ${isDone ? "line-through text-muted-foreground" : ""}`}>
          {todo.title}
        </div>
        {todo.description && (
          <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
            {todo.description}
          </div>
        )}
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-[9px] px-1.5 py-0.5 rounded ${PRIORITY_COLORS[todo.priority]}`}>
            {todo.priority}
          </span>
          {todo.dueDate && (
            <span className="text-[9px] text-muted-foreground">
              Due: {new Date(todo.dueDate).toLocaleDateString()}
            </span>
          )}
          {todo.tags.length > 0 && todo.tags.map((tag) => (
            <span key={tag} className="text-[9px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Delete button */}
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all p-1"
        title="Delete"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
