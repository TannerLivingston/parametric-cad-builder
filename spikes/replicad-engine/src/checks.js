// Independent checks on exported geometry. These read the STL bytes rather than
// trusting OpenCascade's own answers.
import { getOC } from "replicad";

export function brepIsValid(shape) {
  const oc = getOC();
  const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false);
  const valid = analyzer.IsValid(shape.wrapped);
  analyzer.delete();
  return valid;
}

export function parseBinarySTL(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = view.getUint32(80, true);
  const expected = 84 + triangles * 50;
  if (bytes.byteLength !== expected) {
    throw new Error(`STL is ${bytes.byteLength} bytes, header implies ${expected}`);
  }
  const positions = new Float32Array(triangles * 9);
  for (let t = 0; t < triangles; t++) {
    const offset = 84 + t * 50 + 12;
    for (let i = 0; i < 9; i++) positions[t * 9 + i] = view.getFloat32(offset + i * 4, true);
  }
  return { triangles, positions };
}

// Welds vertices, then requires each directed edge to meet exactly one opposite
// edge. Also reports signed volume and the bounding box.
export function analyseMesh({ triangles, positions }) {
  const ids = new Map();
  const vertexId = (i) => {
    const key = `${positions[i]},${positions[i + 1]},${positions[i + 2]}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    return id;
  };
  const edges = new Map();
  const addEdge = (a, b) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const entry = edges.get(key) ?? { forward: 0, backward: 0 };
    if (a < b) entry.forward++;
    else entry.backward++;
    edges.set(key, entry);
  };

  let volume = 0;
  let degenerate = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < triangles; t++) {
    const p = t * 9;
    const [a, b, c] = [vertexId(p), vertexId(p + 3), vertexId(p + 6)];
    if (a === b || b === c || a === c) {
      degenerate++;
      continue;
    }
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
    const [x1, y1, z1, x2, y2, z2, x3, y3, z3] = positions.subarray(p, p + 9);
    volume += (x1 * (y2 * z3 - y3 * z2) - y1 * (x2 * z3 - x3 * z2) + z1 * (x2 * y3 - x3 * y2)) / 6;
    for (let i = 0; i < 9; i++) {
      const axis = i % 3;
      min[axis] = Math.min(min[axis], positions[p + i]);
      max[axis] = Math.max(max[axis], positions[p + i]);
    }
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const { forward, backward } of edges.values()) {
    if (forward === 1 && backward === 1) continue;
    if (forward + backward < 2) openEdges++;
    else nonManifoldEdges++;
  }
  return {
    triangles,
    degenerate,
    openEdges,
    nonManifoldEdges,
    watertight: openEdges === 0 && nonManifoldEdges === 0,
    volume,
    size: max.map((m, i) => m - min[i]),
  };
}

// STEP headers carry a timestamp, which is not a change in geometry.
export function stripStepTimestamp(text) {
  return text
    .replace(/FILE_NAME\([^;]*;/, "FILE_NAME();")
    .replace(/Open CASCADE STEP translator [\d.]+ \d+/g, "Open CASCADE STEP translator");
}

export async function sha256(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
