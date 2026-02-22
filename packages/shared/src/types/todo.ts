export interface Todo {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "done";
  priority: "low" | "medium" | "high";
  dueDate: string | null;
  reminderAt: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
