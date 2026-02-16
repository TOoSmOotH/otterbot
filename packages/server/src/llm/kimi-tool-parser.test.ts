import { describe, it, expect } from "vitest";
import {
  containsKimiToolMarkup,
  findToolMarkupStart,
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
