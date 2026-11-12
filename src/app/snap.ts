// Snapping a dragged part into line: with a neighbour's centre or edge, the middle of its surface,
// wall or floor, or the same gap as the row it's joining. Each snap that holds gives a guide line,
// for the view to draw. Neighbours are those on the same surface, wall or the floor.
import type { SceneComponent, SceneModel } from "./sceneModel.js";

export const SNAP_REACH = 1.5; // how near, in mm, a part has to come to a line to snap to it

export interface Guide {
  axis: "a" | "b"; // a line of constant a (across) or b (up or back)
  value: number;
  kind: "centre" | "edge" | "middle" | "spacing";
}

const STEP = 0.5;
const round = (value: number) => Math.round(value / STEP) * STEP;
const half = (c: SceneComponent): [number, number] => {
  const box = c.above ?? c.floor ?? c.inWall?.face;
  return box ? [box.hu, box.hv] : [0, 0];
};
const placeOf = (c: SceneComponent) => (c.inWall ? `wall ${c.inWall.wall}` : c.mount === "floor" ? "floor" : `surface ${c.curve ?? c.surface?.id}`);

// The length of the place along a and b: the width and the surface's length, a wall's length and
// height, or the floor's width and depth.
function extent(model: SceneModel, c: SceneComponent): [number, number] | null {
  const depth = model.surfaces.at(-1)?.y1 ?? 0;
  if (c.inWall) return null;
  if (c.mount === "floor") return [model.width, depth];
  if (c.curve) return null;
  return c.surface ? [model.width, c.surface.length] : null;
}

// Where the dragged part goes, snapped where it comes near a line on either axis, and the lines it's on.
export function snapDrag(model: SceneModel, id: string, a: number, b: number): { a: number; b: number; guides: Guide[] } {
  const dragged = model.components.find((c) => c.id === id);
  if (!dragged) return { a: round(a), b: round(b), guides: [] };
  const [ha, hb] = half(dragged);
  const neighbours = model.components.filter((c) => c.id !== id && placeOf(c) === placeOf(dragged));
  const size = extent(model, dragged);

  // Candidate lines for the centre on one axis: each with the centre value that puts the part on it.
  const candidates = (axis: "a" | "b", own: number): { at: number; guide: Guide }[] => {
    const mine = axis === "a" ? ha : hb;
    const list: { at: number; guide: Guide }[] = [];
    for (const n of neighbours) {
      const centre = axis === "a" ? n.a : n.b;
      const reach = axis === "a" ? half(n)[0] : half(n)[1];
      list.push({ at: centre, guide: { axis, value: centre, kind: "centre" } });
      list.push({ at: centre - reach + mine, guide: { axis, value: centre - reach, kind: "edge" } });
      list.push({ at: centre + reach - mine, guide: { axis, value: centre + reach, kind: "edge" } });
    }
    if (size) {
      const middle = (axis === "a" ? size[0] : size[1]) / 2;
      list.push({ at: middle, guide: { axis, value: middle, kind: "middle" } });
    }
    // The same gap as the row it's joining, at either end of it.
    if (axis === "a") {
      const row = neighbours.filter((n) => Math.abs(n.b - b) <= SNAP_REACH).sort((x, y) => x.a - y.a);
      if (row.length >= 2) {
        const [first, second] = [row[0]!, row[1]!];
        const [last, before] = [row.at(-1)!, row.at(-2)!];
        list.push({ at: last.a + (last.a - before.a), guide: { axis, value: last.a + (last.a - before.a), kind: "spacing" } });
        list.push({ at: first.a - (second.a - first.a), guide: { axis, value: first.a - (second.a - first.a), kind: "spacing" } });
      }
    }
    return list.filter((c) => Math.abs(c.at - own) <= SNAP_REACH).sort((x, y) => Math.abs(x.at - own) - Math.abs(y.at - own));
  };

  const onA = candidates("a", a)[0];
  const onB = candidates("b", b)[0];
  const hundredths = (value: number) => Math.round(value * 100) / 100;
  const snappedA = onA ? hundredths(onA.at) : round(a);
  const snappedB = onB ? hundredths(onB.at) : round(b);
  return { a: snappedA, b: snappedB, guides: [onA?.guide, onB?.guide].filter((g): g is Guide => g !== undefined) };
}

type Point = [number, number, number];
const LIFT = 0.5; // off the face, so a guide isn't hidden in it

// The guides as lines in the view, across the whole of the part's surface, wall or floor.
export function guideSegments(model: SceneModel, id: string, guides: Guide[]): [Point, Point][] {
  const c = model.components.find((item) => item.id === id);
  if (!c) return [];
  const depth = model.surfaces.at(-1)?.y1 ?? 0;
  const top = Math.max(...model.surfaces.flatMap((s) => [s.z0, s.z1]));
  return guides.map((g): [Point, Point] => {
    if (c.inWall) {
      const side = c.inWall.wall === "left" || c.inWall.wall === "right";
      const fixed = c.inWall.wall === "left" ? -LIFT : c.inWall.wall === "right" ? model.width + LIFT : c.inWall.wall === "front" ? -LIFT : depth + LIFT;
      const length = side ? depth : model.width;
      const at = (along: number, z: number): Point => (side ? [fixed, along, z] : [along, fixed, z]);
      return g.axis === "a" ? [at(g.value, 0), at(g.value, top)] : [at(0, g.value), at(length, g.value)];
    }
    if (c.mount === "floor" || !c.surface) {
      const z = model.floorThickness + LIFT;
      return g.axis === "a" ? [[g.value, 0, z], [g.value, depth, z]] : [[0, g.value, z], [model.width, g.value, z]];
    }
    const s = c.surface;
    const point = (u: number, v: number): Point => [u, s.y0 + v * s.cos - LIFT * s.sin, s.z0 + v * s.sin + LIFT * s.cos];
    return g.axis === "a" ? [point(g.value, 0), point(g.value, s.length)] : [point(0, g.value), point(model.width, g.value)];
  });
}
