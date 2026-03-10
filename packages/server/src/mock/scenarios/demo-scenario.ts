/**
 * Demo scenario — visually impressive timeline for demo recording.
 *
 * Flow:
 * 1. User sends "Build me a personal portfolio website with a blog"
 * 2. COO responds with streaming text, then calls create_project
 * 3. Team Lead spawns, creates kanban tasks, spawns a worker
 * 4. Worker makes tool calls (file_write)
 * 5. Tasks move through kanban columns
 * 6. COO delivers final summary
 */
import type {
  MockScenario,
  MockResponse,
  MockAgentType,
} from "./index.js";
import { registerScenario } from "./index.js";

const cooResponses: MockResponse[] = [
  // Call 1: Check existing projects
  {
    type: "tool-call",
    toolCalls: [{ name: "get_project_status", arguments: {} }],
  },
  // Call 2: Create the portfolio project
  {
    type: "tool-call",
    toolCalls: [
      {
        name: "create_project",
        arguments: {
          name: "Personal Portfolio Website",
          description:
            "Build a modern personal portfolio website with a blog section, project showcase, and contact form.",
          charter: `# Personal Portfolio Website

## Overview
Build a modern, responsive personal portfolio website with the following sections:
- **Hero**: Name, title, and call-to-action
- **About**: Bio and skills
- **Projects**: Showcase of past work with screenshots and links
- **Blog**: Markdown-powered blog with tags and search
- **Contact**: Contact form with email integration

## Technical Stack
- **Frontend**: React + TypeScript + Tailwind CSS
- **Build**: Vite
- **Blog**: MDX for blog posts
- **Deployment**: Static site, deployable to Vercel/Netlify

## Success Criteria
- Lighthouse score > 90 on all metrics
- Fully responsive (mobile, tablet, desktop)
- Blog supports markdown with syntax highlighting
- Contact form validates inputs and sends emails`,
          directive:
            "Build a personal portfolio website with React, TypeScript, and Tailwind CSS. Include a blog section with MDX support, project showcase, and contact form. Ensure the site is fully responsive and achieves high Lighthouse scores.",
        },
      },
    ],
  },
  // Call 3+: Streaming acknowledgment
  {
    type: "text",
    content:
      "I've created the **Personal Portfolio Website** project and assigned a Team Lead to manage the build. The team will set up the React + TypeScript foundation, implement the responsive layout with Tailwind CSS, build the blog engine with MDX, and add the contact form. I'll keep you updated on progress.",
  },
];

const teamLeadResponses: MockResponse[] = [
  // Call 1: Search registry for a capable worker
  {
    type: "tool-call",
    toolCalls: [
      { name: "search_registry", arguments: { capability: "code" } },
    ],
  },
  // Call 2: Create kanban tasks
  {
    type: "tool-call",
    toolCalls: [
      {
        name: "create_task",
        arguments: {
          title: "Set up React + Vite + TypeScript project",
          description:
            "Initialize the project with Vite, React 18, TypeScript, and Tailwind CSS. Set up folder structure, routing, and base layout components.",
          column: "backlog",
        },
      },
      {
        name: "create_task",
        arguments: {
          title: "Build hero and about sections",
          description:
            "Create the Hero component with name, title, animated background, and CTA. Build the About section with bio, skills grid, and profile photo.",
          column: "backlog",
        },
      },
      {
        name: "create_task",
        arguments: {
          title: "Implement project showcase",
          description:
            "Build a filterable project grid with cards showing screenshots, descriptions, tech stack tags, and links to live demos and source code.",
          column: "backlog",
        },
      },
      {
        name: "create_task",
        arguments: {
          title: "Build blog engine with MDX",
          description:
            "Set up MDX processing for blog posts. Create blog list page with tag filtering, individual post page with syntax highlighting, and RSS feed.",
          column: "backlog",
        },
      },
      {
        name: "create_task",
        arguments: {
          title: "Add contact form",
          description:
            "Build a contact form with client-side validation, email integration, success/error states, and spam protection.",
          column: "backlog",
        },
      },
      {
        name: "create_task",
        arguments: {
          title: "Responsive design and Lighthouse optimization",
          description:
            "Ensure all components are fully responsive. Optimize images, fonts, and bundle size. Target Lighthouse score > 90 on all metrics.",
          column: "backlog",
        },
      },
    ],
  },
  // Call 3: Spawn a worker (dynamic — extracts first task ID from results)
  {
    type: "dynamic",
    fn: (messages) => {
      const taskIds: string[] = [];
      for (const m of messages) {
        if (m.role === "tool" && typeof m.content === "string") {
          const match = m.content.match(/created\s+\(([^)]+)\)/i);
          if (match) taskIds.push(match[1]);
        }
      }
      return {
        type: "tool-call",
        toolCalls: [
          {
            name: "spawn_worker",
            arguments: {
              registryEntryId: "mock-full-stack-dev",
              task: "Set up the React + Vite + TypeScript project with Tailwind CSS. Create the base layout, routing, and component structure. Then build the Hero and About sections.",
              taskId: taskIds[0] || undefined,
            },
          },
        ],
      };
    },
  },
  // Call 4: Update first task to done
  {
    type: "dynamic",
    fn: (messages) => {
      const taskIds: string[] = [];
      for (const m of messages) {
        if (m.role === "tool" && typeof m.content === "string") {
          const match = m.content.match(/created\s+\(([^)]+)\)/i);
          if (match) taskIds.push(match[1]);
        }
      }
      return {
        type: "tool-call",
        toolCalls: [
          {
            name: "update_task",
            arguments: {
              taskId: taskIds[0] || "task-1",
              column: "done",
            },
          },
        ],
      };
    },
  },
  // Call 5: Report to COO
  {
    type: "tool-call",
    toolCalls: [
      {
        name: "report_to_coo",
        arguments: {
          content:
            "Project scaffolding complete. React + Vite + TypeScript with Tailwind CSS is set up. Hero and About sections are built. Remaining tasks are in the backlog for the next sprint.",
        },
      },
    ],
  },
  // Call 6+: Done
  {
    type: "text",
    content: "All assigned tasks are complete. The project foundation is solid and ready for the next phase.",
  },
];

const workerResponses: MockResponse[] = [
  // Call 1: Create package.json
  {
    type: "tool-call",
    toolCalls: [
      {
        name: "file_write",
        arguments: {
          path: "package.json",
          content: JSON.stringify(
            {
              name: "portfolio",
              version: "0.1.0",
              private: true,
              type: "module",
              scripts: {
                dev: "vite",
                build: "tsc && vite build",
                preview: "vite preview",
              },
              dependencies: {
                react: "^18.3.0",
                "react-dom": "^18.3.0",
                "react-router-dom": "^6.23.0",
              },
              devDependencies: {
                "@types/react": "^18.3.0",
                "@types/react-dom": "^18.3.0",
                typescript: "^5.4.0",
                vite: "^5.4.0",
                "@vitejs/plugin-react": "^4.3.0",
                tailwindcss: "^3.4.0",
                autoprefixer: "^10.4.0",
                postcss: "^8.4.0",
              },
            },
            null,
            2,
          ),
        },
      },
    ],
  },
  // Call 2: Create main App component
  {
    type: "tool-call",
    toolCalls: [
      {
        name: "file_write",
        arguments: {
          path: "src/App.tsx",
          content: `import { Hero } from './components/Hero';
import { About } from './components/About';
import { Projects } from './components/Projects';
import { Contact } from './components/Contact';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Hero />
      <About />
      <Projects />
      <Contact />
    </div>
  );
}
`,
        },
      },
    ],
  },
  // Call 3+: Done
  {
    type: "text",
    content:
      "Project setup complete. Created package.json with all dependencies and the main App component with section layout.",
  },
];

const demoScenario: MockScenario = {
  id: "demo",
  name: "Portfolio Website Demo",
  streamDelayMs: 30,
  responses: new Map<MockAgentType, MockResponse[]>([
    ["coo", cooResponses],
    ["team_lead", teamLeadResponses],
    ["worker", workerResponses],
  ]),
  steps: [
    {
      type: "user-message",
      delayMs: 2000,
      content: "Build me a personal portfolio website with a blog",
    },
    {
      type: "wait-for-idle",
      delayMs: 0,
    },
  ],
};

registerScenario(demoScenario);

export { demoScenario };
