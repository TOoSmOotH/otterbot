import { useEffect, useState, useRef } from "react";
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

const PRIORITY_CYCLE: Record<string, string> = {
  low: "medium",
  medium: "high",
  high: "low",
};

export function TodoView() {
  const todos = useTodoStore((s) => s.todos);
  const loading = useTodoStore((s) => s.loading);
  const loadTodos = useTodoStore((s) => s.loadTodos);
  const createTodo = useTodoStore((s) => s.createTodo);
  const updateTodo = useTodoStore((s) => s.updateTodo);
  const deleteTodo = useTodoStore((s) => s.deleteTodo);
  const searchQuery = useTodoStore((s) => s.searchQuery);
  const setSearchQuery = useTodoStore((s) => s.setSearchQuery);
  const filterPriority = useTodoStore((s) => s.filterPriority);
  const setFilterPriority = useTodoStore((s) => s.setFilterPriority);

  const [quickTitle, setQuickTitle] = useState("");
  const [showExpanded, setShowExpanded] = useState(false);
  const [newDescription, setNewDescription] = useState("");
  const [newPriority, setNewPriority] = useState("medium");
  const [newDueDate, setNewDueDate] = useState("");
  const [newTags, setNewTags] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("");

  useEffect(() => {
    loadTodos();
  }, []);

  const handleQuickAdd = async () => {
    if (!quickTitle.trim()) return;
    await createTodo({
      title: quickTitle.trim(),
      description: showExpanded ? newDescription.trim() : undefined,
      priority: showExpanded ? newPriority : "medium",
      dueDate: showExpanded && newDueDate ? newDueDate : undefined,
      tags: showExpanded && newTags.trim()
        ? newTags.split(",").map((t) => t.trim()).filter(Boolean)
        : undefined,
    });
    setQuickTitle("");
    setNewDescription("");
    setNewPriority("medium");
    setNewDueDate("");
    setNewTags("");
    setShowExpanded(false);
  };

  const handleStatusCycle = async (todo: Todo) => {
    const next: Record<string, string> = {
      todo: "in_progress",
      in_progress: "done",
      done: "todo",
    };
    await updateTodo(todo.id, { status: next[todo.status] });
  };

  // Filter and search
  const filtered = todos.filter((t) => {
    if (filterStatus && t.status !== filterStatus) return false;
    if (filterPriority && t.priority !== filterPriority) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = t.title.toLowerCase().includes(q);
      const matchDesc = t.description?.toLowerCase().includes(q);
      const matchTags = t.tags.some((tag) => tag.toLowerCase().includes(q));
      if (!matchTitle && !matchDesc && !matchTags) return false;
    }
    return true;
  });

  const grouped = {
    todo: filtered.filter((t) => t.status === "todo"),
    in_progress: filtered.filter((t) => t.status === "in_progress"),
    done: filtered.filter((t) => t.status === "done"),
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
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="text-[10px] bg-secondary rounded px-2 py-1 outline-none w-28 focus:w-40 transition-all focus:ring-1 ring-primary"
          />
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="text-[10px] bg-secondary border-none rounded px-2 py-1 text-foreground outline-none"
          >
            <option value="">All Priority</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-[10px] bg-secondary border-none rounded px-2 py-1 text-foreground outline-none"
          >
            <option value="">All Status</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
          </select>
        </div>
      </div>

      {/* Quick-add bar */}
      <div className="px-4 py-2 border-b border-border bg-secondary/20">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleQuickAdd()}
            placeholder="What needs to be done? Press Enter to add..."
            className="flex-1 bg-secondary rounded px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary"
          />
          <button
            onClick={() => setShowExpanded(!showExpanded)}
            className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 rounded hover:bg-secondary transition-colors"
            title="Expand form"
          >
            {showExpanded ? "▲" : "▼"}
          </button>
          <button
            onClick={handleQuickAdd}
            disabled={!quickTitle.trim()}
            className="text-xs bg-primary text-primary-foreground px-2.5 py-1 rounded hover:bg-primary/90 disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {showExpanded && (
          <div className="mt-2 space-y-2">
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Description (optional)"
              className="w-full bg-secondary rounded px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary resize-none"
              rows={2}
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
              <input
                type="text"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                placeholder="Tags (comma-separated)"
                className="flex-1 text-[10px] bg-secondary rounded px-2 py-1 outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Todo list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {loading && todos.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-8">Loading...</div>
        )}

        {!loading && todos.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-8">
            No todos yet. Type above and press Enter to create one.
          </div>
        )}

        {!loading && todos.length > 0 && filtered.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-8">
            No todos match your filters.
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
                    onUpdate={(data) => updateTodo(todo.id, data)}
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
  onUpdate,
  onDelete,
}: {
  todo: Todo;
  onStatusCycle: () => void;
  onUpdate: (data: Partial<Pick<Todo, "title" | "description" | "priority" | "dueDate" | "tags">>) => void;
  onDelete: () => void;
}) {
  const isDone = todo.status === "done";
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(todo.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState(todo.description || "");
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [editDueDate, setEditDueDate] = useState(todo.dueDate ?? "");
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const tagRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTitle && titleRef.current) titleRef.current.focus();
  }, [editingTitle]);

  useEffect(() => {
    if (editingDesc && descRef.current) descRef.current.focus();
  }, [editingDesc]);

  useEffect(() => {
    if (addingTag && tagRef.current) tagRef.current.focus();
  }, [addingTag]);

  // Sync local state when todo prop changes (from socket updates)
  useEffect(() => {
    if (!editingTitle) setEditTitle(todo.title);
  }, [todo.title, editingTitle]);

  useEffect(() => {
    if (!editingDesc) setEditDesc(todo.description || "");
  }, [todo.description, editingDesc]);

  useEffect(() => {
    if (!editingDueDate) setEditDueDate(todo.dueDate ?? "");
  }, [todo.dueDate, editingDueDate]);

  const saveTitle = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== todo.title) {
      onUpdate({ title: trimmed });
    } else {
      setEditTitle(todo.title);
    }
    setEditingTitle(false);
  };

  const saveDesc = () => {
    const trimmed = editDesc.trim();
    if (trimmed !== (todo.description || "")) {
      onUpdate({ description: trimmed });
    }
    setEditingDesc(false);
  };

  const handlePriorityCycle = () => {
    onUpdate({ priority: PRIORITY_CYCLE[todo.priority] as Todo["priority"] });
  };

  const handleDueDateSave = () => {
    if (editDueDate !== (todo.dueDate ?? "")) {
      onUpdate({ dueDate: editDueDate || null });
    }
    setEditingDueDate(false);
  };

  const handleRemoveTag = (tag: string) => {
    onUpdate({ tags: todo.tags.filter((t) => t !== tag) });
  };

  const handleAddTag = () => {
    const trimmed = newTag.trim();
    if (trimmed && !todo.tags.includes(trimmed)) {
      onUpdate({ tags: [...todo.tags, trimmed] });
    }
    setNewTag("");
    setAddingTag(false);
  };

  // Sync reminderAt when todo prop changes
  const [, setTick] = useState(0);
  useEffect(() => {
    // Force re-render to show/hide countdown when reminderAt changes externally
    setTick((t) => t + 1);
  }, [todo.reminderAt]);

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
        {/* Title — inline edit */}
        {editingTitle ? (
          <input
            ref={titleRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveTitle();
              if (e.key === "Escape") { setEditTitle(todo.title); setEditingTitle(false); }
            }}
            className="w-full text-xs bg-secondary rounded px-1.5 py-0.5 outline-none focus:ring-1 ring-primary"
          />
        ) : (
          <div
            className={`text-xs cursor-pointer hover:text-primary transition-colors ${isDone ? "line-through text-muted-foreground" : ""}`}
            onClick={() => { setEditingTitle(true); setEditTitle(todo.title); }}
          >
            {todo.title}
          </div>
        )}

        {/* Description — inline edit */}
        {editingDesc ? (
          <textarea
            ref={descRef}
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            onBlur={saveDesc}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveDesc(); }
              if (e.key === "Escape") { setEditDesc(todo.description || ""); setEditingDesc(false); }
            }}
            className="w-full text-[10px] bg-secondary rounded px-1.5 py-0.5 mt-0.5 outline-none focus:ring-1 ring-primary resize-none"
            rows={2}
          />
        ) : (
          <div
            className="text-[10px] text-muted-foreground mt-0.5 truncate cursor-pointer hover:text-foreground transition-colors"
            onClick={() => { setEditingDesc(true); setEditDesc(todo.description || ""); }}
          >
            {todo.description || <span className="opacity-0 group-hover:opacity-50">+ Add description</span>}
          </div>
        )}

        {/* Meta row */}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {/* Priority badge — click to cycle */}
          <button
            onClick={handlePriorityCycle}
            className={`text-[9px] px-1.5 py-0.5 rounded cursor-pointer hover:opacity-80 transition-opacity ${PRIORITY_COLORS[todo.priority]}`}
            title="Click to cycle priority"
          >
            {todo.priority}
          </button>

          {/* Reminder countdown */}
          {todo.reminderAt && new Date(todo.reminderAt) > new Date() && (
            <ReminderCountdown reminderAt={todo.reminderAt} />
          )}

          {/* Due date — click to edit */}
          {editingDueDate ? (
            <span className="flex items-center gap-1">
              <input
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
                onBlur={handleDueDateSave}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleDueDateSave();
                  if (e.key === "Escape") { setEditDueDate(todo.dueDate ?? ""); setEditingDueDate(false); }
                }}
                className="text-[9px] bg-secondary rounded px-1 py-0.5 outline-none"
                autoFocus
              />
              {editDueDate && (
                <button
                  onClick={() => { setEditDueDate(""); onUpdate({ dueDate: null }); setEditingDueDate(false); }}
                  className="text-muted-foreground hover:text-red-400 text-[9px]"
                  title="Clear due date"
                >
                  ×
                </button>
              )}
            </span>
          ) : todo.dueDate ? (
            <span
              className="text-[9px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              onClick={() => { setEditDueDate(todo.dueDate ?? ""); setEditingDueDate(true); }}
            >
              Due: {new Date(todo.dueDate).toLocaleDateString()}
            </span>
          ) : (
            <span
              className="text-[9px] text-muted-foreground opacity-0 group-hover:opacity-50 cursor-pointer hover:!opacity-100 transition-opacity"
              onClick={() => { setEditDueDate(""); setEditingDueDate(true); }}
            >
              + Due date
            </span>
          )}

          {/* Tags */}
          {todo.tags.map((tag) => (
            <span
              key={tag}
              className="group/tag text-[9px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground flex items-center gap-0.5"
            >
              {tag}
              <button
                onClick={() => handleRemoveTag(tag)}
                className="opacity-0 group-hover/tag:opacity-100 hover:text-red-400 transition-opacity ml-0.5"
                title="Remove tag"
              >
                ×
              </button>
            </span>
          ))}

          {/* Add tag */}
          {addingTag ? (
            <input
              ref={tagRef}
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onBlur={() => { if (newTag.trim()) handleAddTag(); else setAddingTag(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddTag();
                if (e.key === "Escape") { setNewTag(""); setAddingTag(false); }
              }}
              placeholder="tag"
              className="text-[9px] bg-secondary rounded px-1.5 py-0.5 outline-none w-16 focus:ring-1 ring-primary"
            />
          ) : (
            <button
              onClick={() => setAddingTag(true)}
              className="text-[9px] text-muted-foreground opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity"
              title="Add tag"
            >
              + tag
            </button>
          )}
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

function ReminderCountdown({ reminderAt }: { reminderAt: string }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const update = () => {
      const diff = new Date(reminderAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("now");
        return;
      }
      const totalSec = Math.floor(diff / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      if (h > 0) {
        setRemaining(`${h}h ${m}m`);
      } else {
        setRemaining(`${m}m ${s}s`);
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [reminderAt]);

  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded text-orange-400 bg-orange-500/10">
      {remaining}
    </span>
  );
}
