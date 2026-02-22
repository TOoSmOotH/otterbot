export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  location: string | null;
  start: string;
  end: string;
  allDay: boolean;
  color: string | null;
  source: "local" | "google";
  calendarId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CalendarSummary {
  id: string;
  name: string;
  source: "local" | "google";
  color?: string;
}
