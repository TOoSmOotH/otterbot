declare module "@anthropic-ai/claude-code" {
  export function claude(options: {
    prompt: string;
    cwd?: string;
    model?: string;
    maxTurns?: number;
    permissionMode?: string;
    env?: Record<string, string>;
    abortController?: AbortController;
    [key: string]: unknown;
  }): AsyncIterable<Record<string, unknown>>;
}
