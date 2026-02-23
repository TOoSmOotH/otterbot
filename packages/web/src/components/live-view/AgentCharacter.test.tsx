import { describe, it, expect, vi } from "vitest";
import type * as THREE from "three";

import { findRandomClip, findClip } from "./AgentCharacter";

const createMockAction = (name: string): THREE.AnimationAction => {
  const mockAction = {
    play: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    fadeIn: vi.fn(),
    fadeOut: vi.fn(),
    getClip: vi.fn(() => ({ name })),
  } as unknown as THREE.AnimationAction;
  return mockAction;
};

describe("AgentCharacter helpers", () => {
  describe("findRandomClip", () => {
    it("returns a random matching clip when multiple matches exist", () => {
      const actions = new Map<string, THREE.AnimationAction>();
      actions.set("Working_A", createMockAction("Working_A"));
      actions.set("Working_B", createMockAction("Working_B"));
      actions.set("GenericWorking", createMockAction("GenericWorking"));

      const patterns = [/Working/i, /GenericWorking/i];

      const results = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const result = findRandomClip(actions, patterns);
        if (result) results.add(result);
      }

      expect(results.size).toBeGreaterThan(1);
      expect(results.has("Working_A")).toBe(true);
      expect(results.has("Working_B")).toBe(true);
      expect(results.has("GenericWorking")).toBe(true);
    });

    it("returns undefined when no clips match patterns", () => {
      const actions = new Map<string, THREE.AnimationAction>();
      actions.set("Idle_A", createMockAction("Idle_A"));
      actions.set("Idle_B", createMockAction("Idle_B"));

      const patterns = [/Working/i, /Run/i];

      expect(findRandomClip(actions, patterns)).toBeUndefined();
    });

    it("returns the only matching clip when exactly one matches", () => {
      const actions = new Map<string, THREE.AnimationAction>();
      actions.set("Working_A", createMockAction("Working_A"));
      actions.set("Idle_A", createMockAction("Idle_A"));

      const patterns = [/Working/i, /GenericWorking/i];

      expect(findRandomClip(actions, patterns)).toBe("Working_A");
    });

    it("skips duplicates across patterns", () => {
      const actions = new Map<string, THREE.AnimationAction>();
      actions.set("Interact", createMockAction("Interact"));
      actions.set("Working", createMockAction("Working"));

      const patterns = [/Interact/i, /Working/i, /Interact/i];

      const result = findRandomClip(actions, patterns);
      expect(result).toBeDefined();
      expect(result).not.toBe("Idle_A");
    });

    it("returns undefined for empty actions map", () => {
      const actions = new Map<string, THREE.AnimationAction>();

      expect(findRandomClip(actions, [/Working/i])).toBeUndefined();
    });

    it("ignores case in pattern matching", () => {
      const actions = new Map<string, THREE.AnimationAction>();
      actions.set("working_a", createMockAction("working_a"));
      actions.set("WORKING_B", createMockAction("WORKING_B"));

      const patterns = [/working/i];

      const results = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const result = findRandomClip(actions, patterns);
        if (result) results.add(result);
      }

      expect(results.size).toBe(2);
      expect(results.has("working_a")).toBe(true);
      expect(results.has("WORKING_B")).toBe(true);
    });
  });

  describe("findClip", () => {
    it("returns first matching clip", () => {
      const actions = new Map<string, THREE.AnimationAction>();
      actions.set("Working_A", createMockAction("Working_A"));
      actions.set("Working_B", createMockAction("Working_B"));

      expect(findClip(actions, /Working/i)).toBe("Working_A");
    });

    it("returns undefined when no matches", () => {
      const actions = new Map<string, THREE.AnimationAction>();
      actions.set("Idle_A", createMockAction("Idle_A"));

      expect(findClip(actions, /Working/i)).toBeUndefined();
    });
  });
});
