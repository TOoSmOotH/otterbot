import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

interface WASDControlsProps {
  /** Movement speed in units per second */
  speed?: number;
  /** When true, controls are disabled (e.g. during room builder editing) */
  disabled?: boolean;
}

/**
 * WASD camera movement for the 3D live view.
 *
 * Moves the camera and its OrbitControls target together on the XZ plane,
 * relative to the camera's current horizontal facing direction.
 *
 * - W / ArrowUp    → forward
 * - S / ArrowDown  → backward
 * - A / ArrowLeft  → strafe left
 * - D / ArrowRight → strafe right
 */
export function WASDControls({ speed = 10, disabled = false }: WASDControlsProps) {
  const { camera } = useThree();
  const keys = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (disabled) {
      keys.current.clear();
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore when focus is in form controls
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const key = e.key.toLowerCase();
      if (key === "w" || key === "a" || key === "s" || key === "d" ||
          key === "arrowup" || key === "arrowdown" || key === "arrowleft" || key === "arrowright") {
        keys.current.add(key);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keys.current.delete(key);
    };

    // Clear keys when window loses focus
    const onBlur = () => keys.current.clear();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      keys.current.clear();
    };
  }, [disabled]);

  // Reusable vectors (allocated once, reused per frame)
  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  const delta = useRef(new THREE.Vector3());

  useFrame((state, dt) => {
    if (disabled || keys.current.size === 0) return;

    // Build horizontal forward vector from camera direction
    camera.getWorldDirection(forward.current);
    forward.current.y = 0;
    forward.current.normalize();

    // Right vector is perpendicular on XZ plane
    right.current.crossVectors(forward.current, camera.up).normalize();

    delta.current.set(0, 0, 0);

    const pressed = keys.current;
    if (pressed.has("w") || pressed.has("arrowup")) delta.current.add(forward.current);
    if (pressed.has("s") || pressed.has("arrowdown")) delta.current.sub(forward.current);
    if (pressed.has("a") || pressed.has("arrowleft")) delta.current.sub(right.current);
    if (pressed.has("d") || pressed.has("arrowright")) delta.current.add(right.current);

    if (delta.current.lengthSq() === 0) return;
    delta.current.normalize().multiplyScalar(speed * dt);

    // Move camera position
    camera.position.add(delta.current);

    // Move OrbitControls target so it stays in sync
    const controls = state.controls as unknown as { target?: THREE.Vector3 };
    if (controls?.target) {
      controls.target.add(delta.current);
    }
  });

  return null;
}
