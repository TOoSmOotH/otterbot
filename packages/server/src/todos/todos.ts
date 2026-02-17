import { nanoid } from "nanoid";
import { getDb, schema } from "../db/index.js";
import { eq } from "drizzle-orm";

export interface TodoInput {
  title: string;
  description?: string;
  priority?: string;
  dueDate?: string;
  tags?: string[];
}

export interface TodoUpdate {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  dueDate?: string | null;
  tags?: string[];
}

export function listTodos(filters?: { status?: string; priority?: string }) {
  const db = getDb();
  let rows = db.select().from(schema.todos).all();

  if (filters?.status) {
    rows = rows.filter((t) => t.status === filters.status);
  }
  if (filters?.priority) {
    rows = rows.filter((t) => t.priority === filters.priority);
  }

  // Sort: todo first, then in_progress, then done; within each group by due date
  const statusOrder: Record<string, number> = { todo: 0, in_progress: 1, done: 2 };
  rows.sort((a, b) => {
    const sa = statusOrder[a.status] ?? 9;
    const sb = statusOrder[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    // Then by due date (null last)
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });

  return rows;
}

export function createTodo(input: TodoInput) {
  const db = getDb();
  const now = new Date().toISOString();
  const todo = {
    id: nanoid(),
    title: input.title,
    description: input.description ?? "",
    status: "todo" as const,
    priority: (input.priority ?? "medium") as "low" | "medium" | "high",
    dueDate: input.dueDate ?? null,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  db.insert(schema.todos).values(todo).run();
  return todo;
}

export function updateTodo(id: string, updates: TodoUpdate) {
  const db = getDb();
  const existing = db
    .select()
    .from(schema.todos)
    .where(eq(schema.todos.id, id))
    .get();

  if (!existing) return null;

  const values: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (updates.title !== undefined) values.title = updates.title;
  if (updates.description !== undefined) values.description = updates.description;
  if (updates.status !== undefined) values.status = updates.status;
  if (updates.priority !== undefined) values.priority = updates.priority;
  if (updates.dueDate !== undefined) values.dueDate = updates.dueDate;
  if (updates.tags !== undefined) values.tags = updates.tags;

  db.update(schema.todos)
    .set(values)
    .where(eq(schema.todos.id, id))
    .run();

  return db.select().from(schema.todos).where(eq(schema.todos.id, id)).get();
}

export function deleteTodo(id: string): boolean {
  const db = getDb();
  const existing = db
    .select()
    .from(schema.todos)
    .where(eq(schema.todos.id, id))
    .get();

  if (!existing) return false;

  db.delete(schema.todos).where(eq(schema.todos.id, id)).run();
  return true;
}
