/**
 * Parser for Kimi K2.5 proprietary tool-call markup.
 *
 * Kimi K2.5 emits tool calls as raw text instead of structured tool-call
 * stream events. The markup looks like:
 *
 *   <|tool_calls_section_begin|>
 *   <|tool_call_begin|>functions.<toolName>
 *   ```json
 *   {"arg": "value"}
 *   ```
 *   <|tool_call_end|>
 *   <|tool_calls_section_end|>
 *
 * This module detects, parses, and extracts structured tool calls from that
 * markup so the agent can execute them and feed results back to the model.
 */

import { nanoid } from "nanoid";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";

export interface KimiToolCall {
  name: string;
  args: Record<string, unknown>;
  index: number;
  toolCallId: string;
}

export interface ParseResult {
  /** Text before the tool-call markup (the "clean" assistant response) */
  cleanText: string;
  /** Parsed tool calls extracted from the markup */
  toolCalls: KimiToolCall[];
}

/** Vercel AI SDK tool shape (subset we need for formatting) */
interface AiTool {
  description?: string;
  parameters?: z.ZodType;
}

/**
 * Serialize tool definitions into a text block that Kimi K2.5 can understand.
 *
 * The returned string contains the tool descriptions and parameter schemas,
 * along with the exact markup format Kimi should use to call them.
 * Returns an empty string if no tools are provided.
 */
export function formatToolsForPrompt(
  tools: Record<string, unknown>,
): string {
  const entries = Object.entries(tools);
  if (entries.length === 0) return "";

  const toolSections = entries.map(([name, def]) => {
    const t = def as AiTool;
    let section = `### ${name}`;
    if (t.description) {
      section += `\n${t.description}`;
    }
    if (t.parameters) {
      try {
        const jsonSchema = zodToJsonSchema(t.parameters, { target: "openApi3" });
        section += `\nParameters (JSON Schema):\n${JSON.stringify(jsonSchema)}`;
      } catch {
        // If schema conversion fails, skip parameters
      }
    }
    return section;
  });

  return [
    "## Available Tools",
    "",
    "You have access to the following tools. To call a tool, use this exact format in your response:",
    "",
    "<|tool_calls_section_begin|>",
    "<|tool_call_begin|>functions.<tool_name>",
    "```json",
    '{"param": "value"}',
    "```",
    "<|tool_call_end|>",
    "<|tool_calls_section_end|>",
    "",
    ...toolSections,
  ].join("\n");
}

const SECTION_BEGIN = "<|tool_calls_section_begin|>";
const SECTION_END = "<|tool_calls_section_end|>";
const CALL_BEGIN = "<|tool_call_begin|>";
const CALL_END = "<|tool_call_end|>";

/** Quick check: does the text contain Kimi tool-call markup? */
export function containsKimiToolMarkup(text: string): boolean {
  return text.includes(SECTION_BEGIN);
}

/** Returns the character index where tool-call markup begins, or -1. */
export function findToolMarkupStart(text: string): number {
  return text.indexOf(SECTION_BEGIN);
}

/**
 * Parse Kimi tool-call markup from a complete response string.
 *
 * Returns the clean text (everything before the markup) and an array of
 * parsed tool calls. If the markup is malformed or absent, returns the
 * original text with an empty tool-calls array.
 */
export function parseKimiToolCalls(text: string): ParseResult {
  const sectionStart = text.indexOf(SECTION_BEGIN);
  if (sectionStart === -1) {
    return { cleanText: text, toolCalls: [] };
  }

  const cleanText = text.slice(0, sectionStart).trimEnd();

  const sectionEnd = text.indexOf(SECTION_END, sectionStart);
  if (sectionEnd === -1) {
    // Malformed: no closing tag — return text as-is
    return { cleanText: text, toolCalls: [] };
  }

  const sectionBody = text.slice(
    sectionStart + SECTION_BEGIN.length,
    sectionEnd,
  );

  const toolCalls: KimiToolCall[] = [];
  let searchFrom = 0;

  while (true) {
    const callStart = sectionBody.indexOf(CALL_BEGIN, searchFrom);
    if (callStart === -1) break;

    const callEnd = sectionBody.indexOf(CALL_END, callStart);
    if (callEnd === -1) break;

    const callBody = sectionBody.slice(
      callStart + CALL_BEGIN.length,
      callEnd,
    );

    const parsed = parseSingleCall(callBody, toolCalls.length);
    if (parsed) {
      toolCalls.push(parsed);
    }

    searchFrom = callEnd + CALL_END.length;
  }

  return { cleanText, toolCalls };
}

/**
 * Parse a single tool-call block body, e.g.:
 *
 *   functions.web_search
 *   ```json
 *   {"query": "hello"}
 *   ```
 */
function parseSingleCall(
  body: string,
  index: number,
): KimiToolCall | null {
  const lines = body.trim().split("\n");
  if (lines.length === 0) return null;

  // First line is the function name, possibly prefixed with "functions."
  let name = lines[0].trim();
  if (name.startsWith("functions.")) {
    name = name.slice("functions.".length);
  }
  if (!name) return null;

  // Extract JSON from fenced code block
  let args: Record<string, unknown> = {};
  const jsonStart = body.indexOf("```");
  if (jsonStart !== -1) {
    const afterFence = body.indexOf("\n", jsonStart);
    if (afterFence !== -1) {
      const jsonEnd = body.indexOf("```", afterFence);
      if (jsonEnd !== -1) {
        const jsonStr = body.slice(afterFence + 1, jsonEnd).trim();
        if (jsonStr) {
          try {
            args = JSON.parse(jsonStr);
          } catch {
            // Bad JSON — skip this call
            return null;
          }
        }
      }
    }
  }

  return {
    name,
    args,
    index,
    toolCallId: `kimi_${nanoid()}`,
  };
}
