export interface Camera2D {
  x: number;
  y: number;
  zoom: number;
}

export function createCamera(): Camera2D {
  return { x: 0, y: 0, zoom: 40 };
}

export function worldToScreen(cam: Camera2D, canvasW: number, canvasH: number, wx: number, wy: number): [number, number] {
  const sx = (wx - cam.x) * cam.zoom + canvasW / 2;
  const sy = (wy - cam.y) * cam.zoom + canvasH / 2;
  return [sx, sy];
}

export function screenToWorld(cam: Camera2D, canvasW: number, canvasH: number, sx: number, sy: number): [number, number] {
  const wx = (sx - canvasW / 2) / cam.zoom + cam.x;
  const wy = (sy - canvasH / 2) / cam.zoom + cam.y;
  return [wx, wy];
}

export function zoomAt(cam: Camera2D, canvasW: number, canvasH: number, sx: number, sy: number, factor: number): Camera2D {
  // Zoom toward mouse cursor
  const [wx, wy] = screenToWorld(cam, canvasW, canvasH, sx, sy);
  const newZoom = Math.max(10, Math.min(200, cam.zoom * factor));
  // Adjust camera so the world point under the cursor stays fixed
  const newX = wx - (sx - canvasW / 2) / newZoom;
  const newY = wy - (sy - canvasH / 2) / newZoom;
  return { x: newX, y: newY, zoom: newZoom };
}

export function pan(cam: Camera2D, dx: number, dy: number): Camera2D {
  return {
    x: cam.x - dx / cam.zoom,
    y: cam.y - dy / cam.zoom,
    zoom: cam.zoom,
  };
}

/** Auto-fit the camera to show a bounding box with some padding */
export function fitToRect(
  canvasW: number,
  canvasH: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Camera2D {
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rangeX = maxX - minX || 10;
  const rangeY = maxY - minY || 10;
  const padding = 1.3;
  const zoom = Math.min(canvasW / (rangeX * padding), canvasH / (rangeY * padding));
  return { x: cx, y: cy, zoom: Math.max(10, Math.min(200, zoom)) };
}
