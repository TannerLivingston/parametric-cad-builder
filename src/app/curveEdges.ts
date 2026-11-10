// A curved surface is built as short flats, and the engine reports an edge where each two meet, on
// the outside, underneath and through a seam's lip. Drawn, they make a curve look slatted, so they're
// left out of the view. The edges are still in the files.
import type { Surface } from "../profile.js";

const ALONG = 1e-4; // how far off the width's direction an edge can be
const ASIDE = 0.02; // and off the line through the skin where two flats meet
const PAST = 1.5; // how far past the skin, either side, that line is followed

// Line segments as x, y, z of each end, without those along the joins between a curve's flats.
export function withoutCurveCreases(edges: Float32Array, surfaces: Surface[]): Float32Array {
  const joins = surfaces.flatMap((a) => {
    const b = surfaces[a.index + 1];
    if (!b || !a.curveOf || a.curveOf !== b.curveOf) return [];
    // Through the skin, halfway between the two flats' normals.
    const [by, bz] = [-a.sin - b.sin, a.cos + b.cos];
    const length = Math.sqrt(by * by + bz * bz);
    return [{ y: a.y1, z: a.z1, dy: by / length, dz: bz / length, deep: Math.max(a.thickness, b.thickness) + PAST }];
  });
  if (joins.length === 0) return edges;
  const onJoin = (y: number, z: number) =>
    joins.some((join) => {
      const [vy, vz] = [y - join.y, z - join.z];
      const out = vy * join.dy + vz * join.dz;
      return Math.abs(vy * join.dz - vz * join.dy) <= ASIDE && out <= PAST && out >= -join.deep;
    });
  const kept: number[] = [];
  for (let i = 0; i + 5 < edges.length; i += 6) {
    const [y0, z0, y1, z1] = [edges[i + 1]!, edges[i + 2]!, edges[i + 4]!, edges[i + 5]!];
    const along = Math.abs(y1 - y0) <= ALONG && Math.abs(z1 - z0) <= ALONG;
    if (along && onJoin(y0, z0)) continue;
    for (let k = 0; k < 6; k++) kept.push(edges[i + k]!);
  }
  return Float32Array.from(kept);
}
