import { create } from "zustand";
import type { Project, KanbanTask, Conversation } from "@smoothbot/shared";

interface ProjectState {
  /** All known projects */
  projects: Project[];
  /** Currently active project (null = global/no project) */
  activeProjectId: string | null;
  /** The active project object */
  activeProject: Project | null;
  /** Kanban tasks for the active project */
  tasks: KanbanTask[];
  /** Conversations for the active project */
  projectConversations: Conversation[];

  // Actions
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (project: Project) => void;
  enterProject: (projectId: string, project: Project, conversations: Conversation[], tasks: KanbanTask[]) => void;
  exitProject: () => void;
  setTasks: (tasks: KanbanTask[]) => void;
  addTask: (task: KanbanTask) => void;
  updateTask: (task: KanbanTask) => void;
  removeTask: (taskId: string) => void;
  setProjectConversations: (conversations: Conversation[]) => void;
  addProjectConversation: (conversation: Conversation) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  activeProject: null,
  tasks: [],
  projectConversations: [],

  setProjects: (projects) => set({ projects }),

  addProject: (project) =>
    set((state) => ({
      projects: [project, ...state.projects.filter((p) => p.id !== project.id)],
    })),

  updateProject: (project) =>
    set((state) => ({
      projects: state.projects.map((p) => (p.id === project.id ? project : p)),
      activeProject: state.activeProjectId === project.id ? project : state.activeProject,
    })),

  enterProject: (projectId, project, conversations, tasks) =>
    set({
      activeProjectId: projectId,
      activeProject: project,
      projectConversations: conversations,
      tasks,
    }),

  exitProject: () =>
    set({
      activeProjectId: null,
      activeProject: null,
      tasks: [],
      projectConversations: [],
    }),

  setTasks: (tasks) => set({ tasks }),

  addTask: (task) =>
    set((state) => {
      if (state.activeProjectId !== task.projectId) return state;
      return { tasks: [...state.tasks, task] };
    }),

  updateTask: (task) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === task.id ? task : t)),
    })),

  removeTask: (taskId) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
    })),

  setProjectConversations: (conversations) =>
    set({ projectConversations: conversations }),

  addProjectConversation: (conversation) =>
    set((state) => {
      if (state.activeProjectId !== conversation.projectId) return state;
      return {
        projectConversations: [conversation, ...state.projectConversations],
      };
    }),
}));
