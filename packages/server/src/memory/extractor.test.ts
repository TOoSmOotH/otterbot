import { test, expect } from "vitest";
import { parseFacts } from "./extractor.js";

test("parseFacts extracts entities and temporal markers", () => {
  const raw = `[{"content": "User prefers dark mode", "category": "preference", "importance": 7, "entities": ["dark mode", "UI"], "temporal": "current"}]`;
  const facts = parseFacts(raw);
  expect(facts).toHaveLength(1);
  expect(facts[0]).toMatchObject({
    content: "User prefers dark mode",
    category: "preference",
    importance: 7,
    entities: ["dark mode", "UI"],
    temporal: "current",
  });
});

test("parseFacts defaults missing fields", () => {
  const raw = `[{"content": "User likes pizza"}]`;
  const facts = parseFacts(raw);
  expect(facts).toHaveLength(1);
  expect(facts[0]).toMatchObject({
    content: "User likes pizza",
    category: "general",
    importance: 5,
    entities: [],
    temporal: null,
  });
});

test("parseFacts ignores invalid temporal values", () => {
  const raw = `[{"content": "Test", "temporal": "invalid"}]`;
  const facts = parseFacts(raw);
  expect(facts[0].temporal).toBeNull();
});

test("parseFacts clamps importance", () => {
  const raw = `[{"content": "Test", "importance": 15}, {"content": "Test2", "importance": 0}]`;
  const facts = parseFacts(raw);
  expect(facts[0].importance).toBe(10);
  expect(facts[1].importance).toBe(1);
});

test("parseFacts returns empty on bad JSON", () => {
  expect(parseFacts("not json")).toEqual([]);
  expect(parseFacts("{}")).toEqual([]);
});
