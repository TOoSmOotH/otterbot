/**
 * Procedural 3D model generation — no AI required.
 *
 * Generates simple GLB models: cubes, spheres, planes, cylinders.
 * Works as a zero-dependency fallback when no AI model provider is configured.
 *
 * Outputs minimal valid glTF 2.0 binary (.glb) files.
 */

import type { ModelGenProvider, ModelGenOptions, ModelGenResult } from "./types.js";

type Shape = "cube" | "sphere" | "plane" | "cylinder";

function detectShape(prompt: string): Shape {
  const lower = prompt.toLowerCase();
  if (lower.includes("sphere") || lower.includes("ball") || lower.includes("round")) return "sphere";
  if (lower.includes("plane") || lower.includes("floor") || lower.includes("ground") || lower.includes("flat")) return "plane";
  if (lower.includes("cylinder") || lower.includes("pillar") || lower.includes("column") || lower.includes("barrel")) return "cylinder";
  return "cube";
}

function colorFromPrompt(prompt: string): [number, number, number, number] {
  const colors: Record<string, [number, number, number, number]> = {
    red: [0.86, 0.2, 0.18, 1], blue: [0.15, 0.55, 0.82, 1],
    green: [0.2, 0.6, 0.0, 1], yellow: [0.71, 0.54, 0, 1],
    white: [0.93, 0.91, 0.84, 1], black: [0.1, 0.1, 0.1, 1],
    orange: [0.8, 0.3, 0.09, 1], purple: [0.42, 0.44, 0.77, 1],
    brown: [0.55, 0.35, 0.17, 1], gold: [0.85, 0.65, 0.13, 1],
  };
  const lower = prompt.toLowerCase();
  for (const [word, rgba] of Object.entries(colors)) {
    if (lower.includes(word)) return rgba;
  }
  return [0.6, 0.6, 0.6, 1];
}

interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array;
}

function generateCube(): MeshData {
  // 24 vertices (4 per face, 6 faces)
  const p = 0.5;
  const positions = new Float32Array([
    // Front
    -p, -p, p, p, -p, p, p, p, p, -p, p, p,
    // Back
    p, -p, -p, -p, -p, -p, -p, p, -p, p, p, -p,
    // Top
    -p, p, p, p, p, p, p, p, -p, -p, p, -p,
    // Bottom
    -p, -p, -p, p, -p, -p, p, -p, p, -p, -p, p,
    // Right
    p, -p, p, p, -p, -p, p, p, -p, p, p, p,
    // Left
    -p, -p, -p, -p, -p, p, -p, p, p, -p, p, -p,
  ]);
  const normals = new Float32Array([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
    8, 9, 10, 8, 10, 11,
    12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19,
    20, 21, 22, 20, 22, 23,
  ]);
  return { positions, normals, indices };
}

function generateSphere(segments = 16, rings = 12): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= rings; r++) {
    const theta = (r * Math.PI) / rings;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let s = 0; s <= segments; s++) {
      const phi = (s * 2 * Math.PI) / segments;
      const x = sinTheta * Math.cos(phi);
      const y = cosTheta;
      const z = sinTheta * Math.sin(phi);

      positions.push(x * 0.5, y * 0.5, z * 0.5);
      normals.push(x, y, z);
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

function generatePlane(): MeshData {
  const positions = new Float32Array([
    -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1,
  ]);
  const normals = new Float32Array([
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  ]);
  const indices = new Uint16Array([0, 2, 1, 0, 3, 2]);
  return { positions, normals, indices };
}

function generateCylinder(segments = 16): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const h = 0.5;

  // Side vertices
  for (let i = 0; i <= segments; i++) {
    const angle = (i * 2 * Math.PI) / segments;
    const x = Math.cos(angle) * 0.5;
    const z = Math.sin(angle) * 0.5;
    positions.push(x, -h, z, x, h, z);
    normals.push(Math.cos(angle), 0, Math.sin(angle), Math.cos(angle), 0, Math.sin(angle));
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

function buildGLB(mesh: MeshData, color: [number, number, number, number]): Buffer {
  const posBytes = Buffer.from(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength);
  const normBytes = Buffer.from(mesh.normals.buffer, mesh.normals.byteOffset, mesh.normals.byteLength);
  const idxBytes = Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength);

  // Pad index buffer to 4-byte boundary
  const idxPadding = (4 - (idxBytes.length % 4)) % 4;
  const paddedIdxBytes = idxPadding > 0 ? Buffer.concat([idxBytes, Buffer.alloc(idxPadding)]) : idxBytes;

  const binLength = paddedIdxBytes.length + posBytes.length + normBytes.length;

  // Compute bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    minX = Math.min(minX, mesh.positions[i]);
    minY = Math.min(minY, mesh.positions[i + 1]);
    minZ = Math.min(minZ, mesh.positions[i + 2]);
    maxX = Math.max(maxX, mesh.positions[i]);
    maxY = Math.max(maxY, mesh.positions[i + 1]);
    maxZ = Math.max(maxZ, mesh.positions[i + 2]);
  }

  const vertexCount = mesh.positions.length / 3;

  const gltf = {
    asset: { version: "2.0", generator: "otterbot-procedural" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 1, NORMAL: 2 },
        indices: 0,
        material: 0,
      }],
    }],
    materials: [{
      pbrMetallicRoughness: {
        baseColorFactor: color,
        metallicFactor: 0.1,
        roughnessFactor: 0.8,
      },
    }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5123, // UNSIGNED_SHORT
        count: mesh.indices.length,
        type: "SCALAR",
        max: [vertexCount - 1],
        min: [0],
      },
      {
        bufferView: 1,
        componentType: 5126, // FLOAT
        count: vertexCount,
        type: "VEC3",
        max: [maxX, maxY, maxZ],
        min: [minX, minY, minZ],
      },
      {
        bufferView: 2,
        componentType: 5126,
        count: vertexCount,
        type: "VEC3",
        max: [1, 1, 1],
        min: [-1, -1, -1],
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: idxBytes.length, target: 34963 },
      { buffer: 0, byteOffset: paddedIdxBytes.length, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: paddedIdxBytes.length + posBytes.length, byteLength: normBytes.length, target: 34962 },
    ],
    buffers: [{ byteLength: binLength }],
  };

  const jsonStr = JSON.stringify(gltf);
  // Pad JSON to 4-byte alignment
  const jsonPadding = (4 - (jsonStr.length % 4)) % 4;
  const jsonBuf = Buffer.from(jsonStr + " ".repeat(jsonPadding), "utf-8");

  // GLB header (12 bytes) + JSON chunk (8 + jsonBuf.length) + BIN chunk (8 + binLength)
  const totalLength = 12 + 8 + jsonBuf.length + 8 + binLength;
  const glb = Buffer.alloc(totalLength);
  let offset = 0;

  // Header
  glb.writeUInt32LE(0x46546c67, offset); offset += 4; // magic "glTF"
  glb.writeUInt32LE(2, offset); offset += 4; // version
  glb.writeUInt32LE(totalLength, offset); offset += 4;

  // JSON chunk
  glb.writeUInt32LE(jsonBuf.length, offset); offset += 4;
  glb.writeUInt32LE(0x4e4f534a, offset); offset += 4; // "JSON"
  jsonBuf.copy(glb, offset); offset += jsonBuf.length;

  // BIN chunk
  glb.writeUInt32LE(binLength, offset); offset += 4;
  glb.writeUInt32LE(0x004e4942, offset); offset += 4; // "BIN\0"
  paddedIdxBytes.copy(glb, offset); offset += paddedIdxBytes.length;
  posBytes.copy(glb, offset); offset += posBytes.length;
  normBytes.copy(glb, offset);

  return glb;
}

export class ProceduralModelProvider implements ModelGenProvider {
  type = "procedural" as const;

  async generate(prompt: string, _options?: ModelGenOptions): Promise<ModelGenResult> {
    const shape = detectShape(prompt);
    const color = colorFromPrompt(prompt);

    let mesh: MeshData;
    switch (shape) {
      case "sphere": mesh = generateSphere(); break;
      case "plane": mesh = generatePlane(); break;
      case "cylinder": mesh = generateCylinder(); break;
      default: mesh = generateCube(); break;
    }

    const data = buildGLB(mesh, color);
    return { data, format: "glb", provider: "procedural" };
  }
}
