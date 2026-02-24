import { useState, useEffect, useCallback } from "react";
import { getSocket } from "../../lib/socket";
import type { Memory } from "@otterbot/shared";

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "preference", label: "Preferences" },
  { value: "fact", label: "Facts" },
  { value: "instruction", label: "Instructions" },
  { value: "relationship", label: "Relationships" },
  { value: "general", label: "General" },
];

export function MemoryTab() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState("general");
  const [editImportance, setEditImportance] = useState(5);
  const [showAdd, setShowAdd] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState("general");
  const [newImportance, setNewImportance] = useState(5);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const socket = getSocket();

  const loadMemories = useCallback(() => {
    socket.emit(
      "memory:list",
      {
        category: filterCategory || undefined,
        search: search || undefined,
      },
      (mems) => {
        setMemories(mems ?? []);
      },
    );
  }, [socket, filterCategory, search]);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  const handleAdd = () => {
    if (!newContent.trim()) return;
    setSaving(true);
    setError(null);
    socket.emit(
      "memory:save",
      {
        content: newContent.trim(),
        category: newCategory,
        importance: newImportance,
        source: "user",
      },
      (ack) => {
        setSaving(false);
        if (ack?.ok) {
          setNewContent("");
          setNewImportance(5);
          setShowAdd(false);
          loadMemories();
        } else {
          setError(ack?.error ?? "Failed to save");
        }
      },
    );
  };

  const handleUpdate = (id: string) => {
    if (!editContent.trim()) return;
    setSaving(true);
    socket.emit(
      "memory:save",
      {
        id,
        content: editContent.trim(),
        category: editCategory,
        importance: editImportance,
      },
      (ack) => {
        setSaving(false);
        if (ack?.ok) {
          setEditingId(null);
          loadMemories();
        }
      },
    );
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this memory?")) return;
    socket.emit("memory:delete", { id }, (ack) => {
      if (ack?.ok) loadMemories();
    });
  };

  const handleClearAll = () => {
    if (!confirm("Delete all memories? This action cannot be undone.")) return;
    setClearing(true);
    setError(null);
    socket.emit("memory:clear-all", (ack) => {
      setClearing(false);
      if (ack?.ok) {
        loadMemories();
      } else {
        setError(ack?.error ?? "Failed to clear memories");
      }
    });
  };

  const startEdit = (m: Memory) => {
    setEditingId(m.id);
    setEditContent(m.content);
    setEditCategory(m.category);
    setEditImportance(m.importance);
  };

  return (
    <div className="p-5 space-y-5">
      <div>
        <h3 className="text-xs font-semibold mb-1">Memories</h3>
        <p className="text-xs text-muted-foreground">
          Persistent facts, preferences, and instructions that agents recall
          across conversations. Agents can also save memories via the
          memory_save tool.
        </p>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Search + Filter bar */}
      <div className="flex gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memories..."
          className="flex-1 bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
        >
          + Add
        </button>
      </div>

      {/* Add new memory form */}
      {showAdd && (
        <div className="bg-secondary/50 border border-border rounded p-3 space-y-3">
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Enter a memory... e.g., 'User prefers dark mode' or 'Always use TypeScript'"
            rows={3}
            className="w-full bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
          <div className="flex gap-3 items-end">
            <div>
              <label className="text-xs font-medium mb-1 block">Category</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {CATEGORIES.filter((c) => c.value).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">
                Importance ({newImportance})
              </label>
              <input
                type="range"
                min={1}
                max={10}
                value={newImportance}
                onChange={(e) => setNewImportance(Number(e.target.value))}
                className="w-24"
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={saving || !newContent.trim()}
              className="px-4 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Memory list */}
      <div className="space-y-2">
        {memories.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">
            {search || filterCategory
              ? "No memories match your filters."
              : "No memories yet. Add one above or tell an agent to remember something."}
          </div>
        ) : (
          memories.map((m) => (
            <div
              key={m.id}
              className="bg-secondary/50 border border-border rounded px-3 py-2"
            >
              {editingId === m.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={2}
                    className="w-full bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  />
                  <div className="flex gap-2 items-center">
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground"
                    >
                      {CATEGORIES.filter((c) => c.value).map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={editImportance}
                      onChange={(e) =>
                        setEditImportance(Number(e.target.value))
                      }
                      className="w-20"
                    />
                    <span className="text-xs text-muted-foreground">
                      {editImportance}
                    </span>
                    <button
                      onClick={() => handleUpdate(m.id)}
                      disabled={saving}
                      className="px-2 py-0.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground">{m.content}</p>
                    <div className="flex gap-2 mt-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                        {m.category}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        importance: {m.importance}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        source: {m.source}
                      </span>
                      {m.accessCount > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          recalled: {m.accessCount}x
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => startEdit(m)}
                      className="px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(m.id)}
                      className="px-2 py-0.5 text-[10px] text-red-400 hover:text-red-300 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {memories.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground">
            {memories.length} memor{memories.length === 1 ? "y" : "ies"}
          </p>
          <button
            onClick={handleClearAll}
            disabled={clearing}
            className="px-3 py-1.5 text-xs text-red-400 bg-secondary border border-red-400/20 rounded hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            {clearing ? "Clearing..." : "Clear All Memories"}
          </button>
        </div>
      )}
    </div>
  );
}
