// Independent checks on exported geometry. These read the STL bytes rather than
// trusting OpenCascade's own answers.
import { getOC, type Shape3D } from "replicad";

export function isValidSolid(shape: Shape3D): boolean {
  const oc = getOC();
  const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false);
  const valid = analyzer.IsValid(shape.wrapped);
  analyzer.delete();
  return valid;
}

export interface MeshReport {
  triangles: number;
  degenerate: number;
  openEdges: number;
  nonManifoldEdges: number;
  watertight: boolean;
  volume: number;
  size: [number, number, number];
}

// Welds vertices, then requires each directed edge to meet exactly one opposite
// edge. Also reports signed volume and the bounding box.
export function analyseBinarySTL(bytes: Uint8Array): MeshReport {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = view.getUint32(80, true);
  if (bytes.byteLength !== 84 + triangles * 50) {
    throw new Error(`STL is ${bytes.byteLength} bytes, but its header implies ${84 + triangles * 50}.`);
  }
  const ids = new Map<string, number>();
  const vertex = (offset: number) => {
    const p = [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)] as const;
    const key = p.join(",");
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    return { id, p };
  };
  const edges = new Map<string, { forward: number; backward: number }>();
  const addEdge = (a: number, b: number) => {
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
    const offset = 84 + t * 50 + 12;
    const a = vertex(offset);
    const b = vertex(offset + 12);
    const c = vertex(offset + 24);
    if (a.id === b.id || b.id === c.id || a.id === c.id) {
      degenerate++;
      continue;
    }
    addEdge(a.id, b.id);
    addEdge(b.id, c.id);
    addEdge(c.id, a.id);
    const [x1, y1, z1] = a.p;
    const [x2, y2, z2] = b.p;
    const [x3, y3, z3] = c.p;
    volume += (x1 * (y2 * z3 - y3 * z2) - y1 * (x2 * z3 - x3 * z2) + z1 * (x2 * y3 - x3 * y2)) / 6;
    for (const p of [a.p, b.p, c.p]) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis]!, p[axis]!);
        max[axis] = Math.max(max[axis]!, p[axis]!);
      }
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
    size: [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!],
  };
}
