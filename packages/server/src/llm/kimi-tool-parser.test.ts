import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  containsKimiToolMarkup,
  findToolMarkupStart,
  formatToolsForPrompt,
  parseKimiToolCalls,
} from "./kimi-tool-parser.js";

describe("kimi-tool-parser", () => {
  describe("containsKimiToolMarkup", () => {
    it("returns false for plain text", () => {
      expect(containsKimiToolMarkup("Hello, world!")).toBe(false);
    });

    it("returns true when markup is present", () => {
      expect(
        containsKimiToolMarkup(
          "Some text <|tool_calls_section_begin|> stuff",
        ),
      ).toBe(true);
    });
  });

  describe("findToolMarkupStart", () => {
    it("returns -1 for text without markup", () => {
      expect(findToolMarkupStart("no markup here")).toBe(-1);
    });

    it("returns the index where markup begins", () => {
      const text = "Hello world<|tool_calls_section_begin|>rest";
      expect(findToolMarkupStart(text)).toBe(11);
    });
  });

  describe("formatToolsForPrompt", () => {
    it("returns empty string for empty tools object", () => {
      expect(formatToolsForPrompt({})).toBe("");
    });

    it("correctly serializes tool name, description, and parameters", () => {
      const tools = {
        web_search: {
          description: "Search the web for information.",
          parameters: z.object({
            query: z.string().describe("The search query"),
            maxResults: z.number().optional().describe("Max results"),
          }),
        },
      };

      const result = formatToolsForPrompt(tools);
      expect(result).toContain("## Available Tools");
      expect(result).toContain("<|tool_calls_section_begin|>");
      expect(result).toContain("### web_search");
      expect(result).toContain("Search the web for information.");
      expect(result).toContain("Parameters (JSON Schema):");
      expect(result).toContain('"query"');
    });

    it("handles tools with no parameters", () => {
      const tools = {
        get_time: {
          description: "Get the current time.",
        },
      };

      const result = formatToolsForPrompt(tools);
      expect(result).toContain("### get_time");
      expect(result).toContain("Get the current time.");
      expect(result).not.toContain("Parameters (JSON Schema):");
    });

    it("handles multiple tools", () => {
      const tools = {
        tool_a: { description: "First tool." },
        tool_b: { description: "Second tool." },
      };

      const result = formatToolsForPrompt(tools);
      expect(result).toContain("### tool_a");
      expect(result).toContain("### tool_b");
    });
  });

  describe("parseKimiToolCalls", () => {
    it("returns original text with no tool calls when there is no markup", () => {
      const result = parseKimiToolCalls("Just a regular response.");
      expect(result.cleanText).toBe("Just a regular response.");
      expect(result.toolCalls).toEqual([]);
    });

    it("parses a single tool call", () => {
      const text = [
        "Here is my response.",
        "<|tool_calls_section_begin|>",
        "<|tool_call_begin|>functions.web_search",
        "```json",
        '{"query": "weather today"}',
        "```",
        "<|tool_call_end|>",
        "<|tool_calls_section_end|>",
      ].join("\n");

      const result = parseKimiToolCalls(text);
      expect(result.cleanText).toBe("Here is my response.");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe("web_search");
      expect(result.toolCalls[0].args).toEqual({ query: "weather today" });
      expect(result.toolCalls[0].index).toBe(0);
      expect(result.toolCalls[0].toolCallId).toMatch(/^kimi_/);
    });

    it("parses multiple tool calls", () => {
      const text = [
        "Let me search for that.",
        "<|tool_calls_section_begin|>",
        "<|tool_call_begin|>functions.web_search",
        "```json",
        '{"query": "first query"}',
        "```",
        "<|tool_call_end|>",
        "<|tool_call_begin|>functions.web_browse",
        "```json",
        '{"url": "https://example.com"}',
        "```",
        "<|tool_call_end|>",
        "<|tool_calls_section_end|>",
      ].join("\n");

      const result = parseKimiToolCalls(text);
      expect(result.cleanText).toBe("Let me search for that.");
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe("web_search");
      expect(result.toolCalls[0].args).toEqual({ query: "first query" });
      expect(result.toolCalls[0].index).toBe(0);
      expect(result.toolCalls[1].name).toBe("web_browse");
      expect(result.toolCalls[1].args).toEqual({ url: "https://example.com" });
      expect(result.toolCalls[1].index).toBe(1);
    });

    it("handles tool calls with empty args (no JSON block)", () => {
      const text = [
        "Calling tool.",
        "<|tool_calls_section_begin|>",
        "<|tool_call_begin|>functions.get_time",
        "<|tool_call_end|>",
        "<|tool_calls_section_end|>",
      ].join("\n");

      const result = parseKimiToolCalls(text);
      expect(result.cleanText).toBe("Calling tool.");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe("get_time");
      expect(result.toolCalls[0].args).toEqual({});
    });

    it("strips functions. prefix from tool names", () => {
      const text = [
        "",
        "<|tool_calls_section_begin|>",
        "<|tool_call_begin|>functions.my_tool",
        "```json",
        "{}",
        "```",
        "<|tool_call_end|>",
        "<|tool_calls_section_end|>",
      ].join("\n");

      const result = parseKimiToolCalls(text);
      expect(result.toolCalls[0].name).toBe("my_tool");
    });

    it("handles tool names without functions. prefix", () => {
      const text = [
        "",
        "<|tool_calls_section_begin|>",
        "<|tool_call_begin|>my_tool",
        "```json",
        '{"a": 1}',
        "```",
        "<|tool_call_end|>",
        "<|tool_calls_section_end|>",
      ].join("\n");

      const result = parseKimiToolCalls(text);
      expect(result.toolCalls[0].name).toBe("my_tool");
    });

    it("returns text as-is when markup is malformed (no closing section tag)", () => {
      const text = [
        "Some text",
        "<|tool_calls_section_begin|>",
        "<|tool_call_begin|>functions.web_search",
        "```json",
        '{"query": "test"}',
        "```",
        "<|tool_call_end|>",
        // Missing <|tool_calls_section_end|>
      ].join("\n");

      const result = parseKimiToolCalls(text);
      expect(result.cleanText).toBe(text);
      expect(result.toolCalls).toEqual([]);
    });

    it("skips tool calls with bad JSON args", () => {
      const text = [
        "Response",
        "<|tool_calls_section_begin|>",
        "<|tool_call_begin|>functions.good_tool",
        "```json",
        '{"valid": true}',
        "```",
        "<|tool_call_end|>",
        "<|tool_call_begin|>functions.bad_tool",
        "```json",
        "{not valid json!!!}",
        "```",
        "<|tool_call_end|>",
        "<|tool_calls_section_end|>",
      ].join("\n");

      const result = parseKimiToolCalls(text);
      expect(result.cleanText).toBe("Response");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe("good_tool");
    });

    it("trims trailing whitespace from clean text", () => {
      const text = [
        "Response with trailing space   ",
        "",
        "<|tool_calls_section_begin|>",
        "<|tool_call_begin|>functions.t",
        "<|tool_call_end|>",
        "<|tool_calls_section_end|>",
      ].join("\n");

      const result = parseKimiToolCalls(text);
      expect(result.cleanText).toBe("Response with trailing space");
    });

    it("parses Format B with argument markers and index suffix", () => {
      const text = [
        "Let me check.",
        "<|tool_calls_section_begin|>",
        "<|tool_call_begin|>functions.get_project_status:0<|tool_call_argument_begin|>",
        "{}",
        "<|tool_call_argument_end|>",
        "<|tool_call_end|>",
        "<|tool_calls_section_end|>",
      ].join("\n");

      const result = parseKimiToolCalls(text);
      expect(result.cleanText).toBe("Let me check.");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe("get_project_status");
      expect(result.toolCalls[0].args).toEqual({});
    });

    it("parses Format B with non-empty args", () => {
      const text = [
        "",
        "<|tool_calls_section_begin|>",
        "<|tool_call_begin|>functions.web_search:0<|tool_call_argument_begin|>",
        '{"query": "weather today"}',
        "<|tool_call_argument_end|>",
        "<|tool_call_end|>",
        "<|tool_calls_section_end|>",
      ].join("\n");

      const result = parseKimiToolCalls(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe("web_search");
      expect(result.toolCalls[0].args).toEqual({ query: "weather today" });
    });

    it("parses Format B with inline argument (no newline)", () => {
      const text = [
        "",
        "<|tool_calls_section_begin|>",
        "<|tool_call_begin|>functions.get_project_status:0<|tool_call_argument_begin|>{}<|tool_call_argument_end|>",
        "<|tool_call_end|>",
        "<|tool_calls_section_end|>",
      ].join("\n");

      const result = parseKimiToolCalls(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe("get_project_status");
      expect(result.toolCalls[0].args).toEqual({});
    });

    it("strips :N index suffix from Format A tool names too", () => {
      const text = [
        "",
        "<|tool_calls_section_begin|>",
        "<|tool_call_begin|>functions.my_tool:2",
        "```json",
        '{"x": 1}',
        "```",
        "<|tool_call_end|>",
        "<|tool_calls_section_end|>",
      ].join("\n");

      const result = parseKimiToolCalls(text);
      expect(result.toolCalls[0].name).toBe("my_tool");
    });

    it("returns empty clean text when markup is at the very start", () => {
      const text = [
        "<|tool_calls_section_begin|>",
        "<|tool_call_begin|>functions.t",
        "```json",
        "{}",
        "```",
        "<|tool_call_end|>",
        "<|tool_calls_section_end|>",
      ].join("\n");

      const result = parseKimiToolCalls(text);
      expect(result.cleanText).toBe("");
      expect(result.toolCalls).toHaveLength(1);
    });
  });
});
