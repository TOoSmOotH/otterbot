/**
 * Scenario types & registry for mock mode.
 *
 * Scenarios define scripted LLM responses per agent type and optional
 * timed actions (user messages, wait-for-idle) that drive the UI
 * automatically.
 */

// ---------------------------------------------------------------------------
// Mock response types
// ---------------------------------------------------------------------------

export interface MockToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MockTextResponse {
  type: "text";
  content: string;
}

export interface MockToolCallResponse {
  type: "tool-call";
  toolCalls: MockToolCall[];
}

/**
 * A "dynamic" response receives the conversation messages and can
 * inspect tool results to extract IDs (e.g. task IDs from create_task).
 */
export interface MockDynamicResponse {
  type: "dynamic";
  fn: (messages: Array<{ role: string; content?: string }>) => MockTextResponse | MockToolCallResponse;
}

export type MockResponse = MockTextResponse | MockToolCallResponse | MockDynamicResponse;

// ---------------------------------------------------------------------------
// Agent types recognized by mock mode
// ---------------------------------------------------------------------------

export type MockAgentType = "coo" | "team_lead" | "worker" | "other";

// ---------------------------------------------------------------------------
// Scenario step types
// ---------------------------------------------------------------------------

export interface UserMessageStep {
  type: "user-message";
  delayMs: number;
  content: string;
}

export interface WaitForIdleStep {
  type: "wait-for-idle";
  delayMs: number;
}

export type ScenarioStep = UserMessageStep | WaitForIdleStep;

// ---------------------------------------------------------------------------
// Scenario interface
// ---------------------------------------------------------------------------

export interface MockScenario {
  id: string;
  name: string;
  streamDelayMs: number;
  /** Scripted responses per agent type, indexed by call number (0-based). */
  responses: Map<MockAgentType, MockResponse[]>;
  /** Timed actions to drive the UI automatically. */
  steps: ScenarioStep[];
}

// ---------------------------------------------------------------------------
// Scenario registry
// ---------------------------------------------------------------------------

const scenarioRegistry = new Map<string, MockScenario>();

export function registerScenario(scenario: MockScenario): void {
  scenarioRegistry.set(scenario.id, scenario);
}

export function getScenario(id: string): MockScenario | undefined {
  return scenarioRegistry.get(id);
}

export function listScenarios(): MockScenario[] {
  return [...scenarioRegistry.values()];
}
