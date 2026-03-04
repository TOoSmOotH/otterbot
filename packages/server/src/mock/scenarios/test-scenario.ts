/**
 * Test scenario — fast, deterministic flow for E2E testing.
 *
 * Same structure as the demo scenario but with zero delays and minimal text.
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
  // Call 2: Create project
  {
    type: "tool-call",
    toolCalls: [
      {
        name: "create_project",
        arguments: {
          name: "Test App",
          description: "A test application for E2E validation",
          charter:
            "# Test App\n\nBuild a minimal test application to validate the mock mode pipeline.",
          directive:
            "Build a minimal test application. Create at least one file and one kanban task.",
        },
      },
    ],
  },
  // Call 3+: Ack
  { type: "text", content: "Project created. Monitoring." },
];

const teamLeadResponses: MockResponse[] = [
  // Call 1: Search registry
  {
    type: "tool-call",
    toolCalls: [
      { name: "search_registry", arguments: { capability: "code" } },
    ],
  },
  // Call 2: Create tasks
  {
    type: "tool-call",
    toolCalls: [
      {
        name: "create_task",
        arguments: {
          title: "Build test feature",
          description: "Create the test feature",
          column: "backlog",
        },
      },
    ],
  },
  // Call 3: Spawn worker
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
              task: "Build the test feature.",
              taskId: taskIds[0] || undefined,
            },
          },
        ],
      };
    },
  },
  // Call 4: Update task to done
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
  // Call 5: Report
  {
    type: "tool-call",
    toolCalls: [
      {
        name: "report_to_coo",
        arguments: { content: "All tasks completed." },
      },
    ],
  },
  // Call 6+: Text
  { type: "text", content: "Done." },
];

const workerResponses: MockResponse[] = [
  // Call 1: Write a file
  {
    type: "tool-call",
    toolCalls: [
      {
        name: "file_write",
        arguments: {
          path: "index.ts",
          content: '// Test file\nconsole.log("hello");\n',
        },
      },
    ],
  },
  // Call 2+: Done
  { type: "text", content: "Done." },
];

const testScenario: MockScenario = {
  id: "test",
  name: "E2E Test Scenario",
  streamDelayMs: 0,
  responses: new Map<MockAgentType, MockResponse[]>([
    ["coo", cooResponses],
    ["team_lead", teamLeadResponses],
    ["worker", workerResponses],
  ]),
  steps: [
    {
      type: "user-message",
      delayMs: 500,
      content: "Build a test application",
    },
    {
      type: "wait-for-idle",
      delayMs: 0,
    },
  ],
};

registerScenario(testScenario);

export { testScenario };
