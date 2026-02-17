import { google } from "googleapis";
import { getAuthenticatedClient } from "./google-auth.js";
import type { CalendarEvent } from "@otterbot/shared";

async function getCalendarApi() {
  const auth = await getAuthenticatedClient();
  if (!auth) throw new Error("Google account not connected. Connect in Settings > Google.");
  return google.calendar({ version: "v3", auth });
}

export async function listCalendars() {
  const cal = await getCalendarApi();
  const res = await cal.calendarList.list();
  return (res.data.items ?? []).map((c) => ({
    id: c.id!,
    name: c.summary ?? c.id!,
    source: "google" as const,
    color: c.backgroundColor ?? undefined,
  }));
}

export async function listGoogleEvents(
  timeMin?: string,
  timeMax?: string,
  calendarId = "primary",
): Promise<CalendarEvent[]> {
  const cal = await getCalendarApi();
  const params: Record<string, unknown> = {
    calendarId,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 100,
  };
  if (timeMin) params.timeMin = timeMin;
  if (timeMax) params.timeMax = timeMax;

  const res = await cal.events.list(params as any);
  return (res.data.items ?? []).map((e) => ({
    id: e.id!,
    title: e.summary ?? "(untitled)",
    description: e.description ?? "",
    location: e.location ?? null,
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    allDay: !!e.start?.date,
    color: e.colorId ?? null,
    source: "google" as const,
    calendarId,
  }));
}

export async function createGoogleEvent(input: {
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay?: boolean;
  calendarId?: string;
}): Promise<CalendarEvent> {
  const cal = await getCalendarApi();
  const calId = input.calendarId ?? "primary";

  const startEnd = input.allDay
    ? {
        start: { date: input.start.slice(0, 10) },
        end: { date: input.end.slice(0, 10) },
      }
    : {
        start: { dateTime: input.start },
        end: { dateTime: input.end },
      };

  const res = await cal.events.insert({
    calendarId: calId,
    requestBody: {
      summary: input.title,
      description: input.description,
      location: input.location,
      ...startEnd,
    },
  });

  return {
    id: res.data.id!,
    title: res.data.summary ?? input.title,
    description: res.data.description ?? "",
    location: res.data.location ?? null,
    start: res.data.start?.dateTime ?? res.data.start?.date ?? input.start,
    end: res.data.end?.dateTime ?? res.data.end?.date ?? input.end,
    allDay: !!res.data.start?.date,
    color: null,
    source: "google",
    calendarId: calId,
  };
}

export async function updateGoogleEvent(
  eventId: string,
  updates: {
    title?: string;
    description?: string;
    location?: string;
    start?: string;
    end?: string;
    allDay?: boolean;
    calendarId?: string;
  },
): Promise<CalendarEvent | null> {
  const cal = await getCalendarApi();
  const calId = updates.calendarId ?? "primary";

  const body: Record<string, unknown> = {};
  if (updates.title !== undefined) body.summary = updates.title;
  if (updates.description !== undefined) body.description = updates.description;
  if (updates.location !== undefined) body.location = updates.location;

  if (updates.start || updates.end) {
    if (updates.allDay) {
      if (updates.start) body.start = { date: updates.start.slice(0, 10) };
      if (updates.end) body.end = { date: updates.end.slice(0, 10) };
    } else {
      if (updates.start) body.start = { dateTime: updates.start };
      if (updates.end) body.end = { dateTime: updates.end };
    }
  }

  const res = await cal.events.patch({
    calendarId: calId,
    eventId,
    requestBody: body as any,
  });

  return {
    id: res.data.id!,
    title: res.data.summary ?? "",
    description: res.data.description ?? "",
    location: res.data.location ?? null,
    start: res.data.start?.dateTime ?? res.data.start?.date ?? "",
    end: res.data.end?.dateTime ?? res.data.end?.date ?? "",
    allDay: !!res.data.start?.date,
    color: null,
    source: "google",
    calendarId: calId,
  };
}

export async function deleteGoogleEvent(
  eventId: string,
  calendarId = "primary",
): Promise<boolean> {
  const cal = await getCalendarApi();
  try {
    await cal.events.delete({ calendarId, eventId });
    return true;
  } catch {
    return false;
  }
}
