declare module "@anthropic-ai/claude-agent-sdk" {
  export function query(options: {
    prompt: string;
    cwd?: string;
    model?: string;
    maxTurns?: number;
    permissionMode?: string;
    env?: Record<string, string>;
    abortController?: AbortController;
    options?: {
      systemPrompt?: string | { type: string; preset: string };
      settingSources?: string[];
    };
    [key: string]: unknown;
  }): AsyncIterable<Record<string, unknown>>;
}
