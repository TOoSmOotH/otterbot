import { nanoid } from "nanoid";
import { getDb, schema } from "../db/index.js";
import { eq, and, gte, lte } from "drizzle-orm";

export interface LocalEventInput {
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay?: boolean;
  color?: string;
}

export function listLocalEvents(timeMin?: string, timeMax?: string) {
  const db = getDb();
  let rows = db.select().from(schema.calendarEvents).all();

  if (timeMin) {
    rows = rows.filter((e) => e.end >= timeMin);
  }
  if (timeMax) {
    rows = rows.filter((e) => e.start <= timeMax);
  }

  rows.sort((a, b) => a.start.localeCompare(b.start));

  return rows.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    location: e.location,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    color: e.color,
    source: "local" as const,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }));
}

export function createLocalEvent(input: LocalEventInput) {
  const db = getDb();
  const now = new Date().toISOString();
  const event = {
    id: nanoid(),
    title: input.title,
    description: input.description ?? "",
    location: input.location ?? null,
    start: input.start,
    end: input.end,
    allDay: input.allDay ?? false,
    recurrence: null,
    color: input.color ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(schema.calendarEvents).values(event).run();
  return { ...event, source: "local" as const };
}

export function updateLocalEvent(
  id: string,
  updates: Partial<LocalEventInput>,
) {
  const db = getDb();
  const existing = db
    .select()
    .from(schema.calendarEvents)
    .where(eq(schema.calendarEvents.id, id))
    .get();

  if (!existing) return null;

  const values: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (updates.title !== undefined) values.title = updates.title;
  if (updates.description !== undefined) values.description = updates.description;
  if (updates.location !== undefined) values.location = updates.location;
  if (updates.start !== undefined) values.start = updates.start;
  if (updates.end !== undefined) values.end = updates.end;
  if (updates.allDay !== undefined) values.allDay = updates.allDay;
  if (updates.color !== undefined) values.color = updates.color;

  db.update(schema.calendarEvents)
    .set(values)
    .where(eq(schema.calendarEvents.id, id))
    .run();

  const updated = db
    .select()
    .from(schema.calendarEvents)
    .where(eq(schema.calendarEvents.id, id))
    .get();

  return updated ? { ...updated, source: "local" as const } : null;
}

export function deleteLocalEvent(id: string): boolean {
  const db = getDb();
  const existing = db
    .select()
    .from(schema.calendarEvents)
    .where(eq(schema.calendarEvents.id, id))
    .get();

  if (!existing) return false;

  db.delete(schema.calendarEvents)
    .where(eq(schema.calendarEvents.id, id))
    .run();
  return true;
}
