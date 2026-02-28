import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as THREE from "three";

const mockState = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>,
  refIndex: 0,
  cleanups: [] as Array<() => void>,
  frameCallback: undefined as undefined | ((state: unknown, dt: number) => void),
  camera: undefined as
    | undefined
    | {
        position: THREE.Vector3;
        up: THREE.Vector3;
        getWorldDirection: (target: THREE.Vector3) => THREE.Vector3;
      },
  listeners: new Map<string, Set<(event: unknown) => void>>(),
}));

vi.mock("react", () => ({
  useRef: (initialValue: unknown) => {
    const i = mockState.refIndex++;
    if (!mockState.refs[i]) {
      mockState.refs[i] = { current: initialValue };
    }
    return mockState.refs[i];
  },
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (typeof cleanup === "function") {
      mockState.cleanups.push(cleanup);
    }
  },
}));

vi.mock("@react-three/fiber", () => ({
  useThree: () => ({ camera: mockState.camera }),
  useFrame: (cb: (state: unknown, dt: number) => void) => {
    mockState.frameCallback = cb;
  },
}));

import { WASDControls } from "./WASDControls";

function dispatchWindowEvent(type: string, event: unknown) {
  const handlers = mockState.listeners.get(type);
  if (!handlers) return;
  for (const handler of handlers) {
    handler(event);
  }
}

function mountWASDControls(props?: { speed?: number; disabled?: boolean }) {
  mockState.refIndex = 0;
  WASDControls(props ?? {});
  expect(mockState.frameCallback).toBeDefined();
}

describe("WASDControls", () => {
  beforeEach(() => {
    mockState.refs = [];
    mockState.refIndex = 0;
    mockState.cleanups = [];
    mockState.frameCallback = undefined;
    mockState.listeners.clear();
    mockState.camera = {
      position: new THREE.Vector3(0, 1, 0),
      up: new THREE.Vector3(0, 1, 0),
      getWorldDirection: (target: THREE.Vector3) => target.set(0, 0, -1),
    };

    (globalThis as { window?: unknown }).window = {
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        const existing = mockState.listeners.get(type);
        if (existing) {
          existing.add(handler);
          return;
        }
        mockState.listeners.set(type, new Set([handler]));
      },
      removeEventListener: (type: string, handler: (event: unknown) => void) => {
        mockState.listeners.get(type)?.delete(handler);
      },
    };
  });

  it("moves camera and controls target forward when W is pressed", () => {
    mountWASDControls({ speed: 10 });

    const target = new THREE.Vector3(2, 0, 2);
    dispatchWindowEvent("keydown", { key: "w", target: { tagName: "DIV" } });
    mockState.frameCallback?.({ controls: { target } }, 0.5);

    expect(mockState.camera?.position.x).toBeCloseTo(0, 6);
    expect(mockState.camera?.position.y).toBeCloseTo(1, 6);
    expect(mockState.camera?.position.z).toBeCloseTo(-5, 6);
    expect(target.x).toBeCloseTo(2, 6);
    expect(target.z).toBeCloseTo(-3, 6);
  });

  it("normalizes diagonal movement for W + D", () => {
    mountWASDControls({ speed: 10 });

    dispatchWindowEvent("keydown", { key: "w", target: { tagName: "DIV" } });
    dispatchWindowEvent("keydown", { key: "d", target: { tagName: "DIV" } });
    mockState.frameCallback?.({ controls: { target: new THREE.Vector3() } }, 1);

    expect(mockState.camera?.position.x).toBeCloseTo(7.07106781, 5);
    expect(mockState.camera?.position.z).toBeCloseTo(-7.07106781, 5);
  });

  it("ignores movement keys when focus is in input controls", () => {
    mountWASDControls({ speed: 10 });

    dispatchWindowEvent("keydown", { key: "w", target: { tagName: "INPUT" } });
    mockState.frameCallback?.({ controls: { target: new THREE.Vector3() } }, 1);

    expect(mockState.camera?.position.x).toBeCloseTo(0, 6);
    expect(mockState.camera?.position.z).toBeCloseTo(0, 6);
  });

  it("clears pressed keys on window blur", () => {
    mountWASDControls({ speed: 10 });

    dispatchWindowEvent("keydown", { key: "ArrowUp", target: { tagName: "DIV" } });
    dispatchWindowEvent("blur", {});
    mockState.frameCallback?.({ controls: { target: new THREE.Vector3() } }, 1);

    expect(mockState.camera?.position.z).toBeCloseTo(0, 6);
  });

  it("does not register listeners or move when disabled", () => {
    mountWASDControls({ speed: 10, disabled: true });

    expect(mockState.listeners.get("keydown")?.size ?? 0).toBe(0);
    expect(mockState.listeners.get("keyup")?.size ?? 0).toBe(0);
    expect(mockState.listeners.get("blur")?.size ?? 0).toBe(0);

    mockState.frameCallback?.({ controls: { target: new THREE.Vector3() } }, 1);
    expect(mockState.camera?.position.z).toBeCloseTo(0, 6);
  });

  it("removes listeners during effect cleanup", () => {
    mountWASDControls();
    expect(mockState.listeners.get("keydown")?.size ?? 0).toBe(1);
    expect(mockState.listeners.get("keyup")?.size ?? 0).toBe(1);
    expect(mockState.listeners.get("blur")?.size ?? 0).toBe(1);

    for (const cleanup of mockState.cleanups) {
      cleanup();
    }

    expect(mockState.listeners.get("keydown")?.size ?? 0).toBe(0);
    expect(mockState.listeners.get("keyup")?.size ?? 0).toBe(0);
    expect(mockState.listeners.get("blur")?.size ?? 0).toBe(0);
  });
});

describe("LiveViewScene wiring", () => {
  it("passes builder state to WASDControls disabled prop", () => {
    const source = readFileSync(resolve(__dirname, "./LiveViewScene.tsx"), "utf-8");

    expect(source).toContain('import { WASDControls } from "./WASDControls";');
    expect(source).toContain("<WASDControls disabled={builderActive} />");
  });
});
