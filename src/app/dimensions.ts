// The distances from a selected part to the edges of where it sits, shown in the view beside it, to
// click and type what each should be. On a top surface: to its left and right ends and its front
// and back edges. On the floor: to the walls. In a wall: to its ends, the bottom and the top.
import type { SceneComponent, SceneModel } from "./sceneModel.js";

export type Side = "left" | "right" | "front" | "back";

export interface Dimension {
  side: Side;
  to: string | null; // the neighbour it's measured to, or null for the edge of where it sits
  value: number; // mm from the part's edge to that edge
  at: [number, number, number]; // where to show it, halfway across the gap
}

type Point = [number, number, number];
const LIFT = 1;

// Where a and b are on the part's surface, floor or wall, and how far each runs.
export function frameOf(model: SceneModel, c: SceneComponent): { point(a: number, b: number): Point; size: [number, number] } | null {
  const depth = model.surfaces.at(-1)?.y1 ?? 0;
  if (c.inWall) {
    const side = c.inWall.wall === "left" || c.inWall.wall === "right";
    const fixed = c.inWall.wall === "left" ? -LIFT : c.inWall.wall === "right" ? model.width + LIFT : c.inWall.wall === "front" ? -LIFT : depth + LIFT;
    // Its height there: the front height at the front, the last surface's at the rear, the lower of the ends at a side.
    const heights = model.surfaces.flatMap((s) => [s.z0, s.z1]);
    const top = c.inWall.wall === "front" ? (model.surfaces[0]?.z0 ?? 0) : c.inWall.wall === "rear" ? (model.surfaces.at(-1)?.z1 ?? 0) : Math.min(...heights);
    return { point: (a, b) => (side ? [fixed, a, b] : [a, fixed, b]), size: [side ? depth : model.width, top] };
  }
  if (c.mount === "floor") {
    const z = model.floorThickness + LIFT;
    return { point: (a, b) => [a, b, z], size: [model.width, depth] };
  }
  if (c.curve || !c.surface) return null;
  const s = c.surface;
  return { point: (a, b) => [a, s.y0 + b * s.cos - LIFT * s.sin, s.z0 + b * s.sin + LIFT * s.cos], size: [model.width, s.length] };
}

const halfOf = (c: SceneComponent): [number, number] => {
  const box = c.above ?? c.floor ?? c.inWall?.face;
  return box ? [box.hu, box.hv] : [0, 0];
};
const round = (value: number) => Math.round(value * 100) / 100;

const placeOf = (c: SceneComponent) => (c.inWall ? `wall ${c.inWall.wall}` : c.mount === "floor" ? "floor" : `surface ${c.curve ?? c.surface?.id}`);

// What each side measures to: the edge of the nearest neighbour that way, among those it would run
// into going straight that way, or else the edge of where it sits.
function stops(model: SceneModel, c: SceneComponent, size: [number, number]): Record<Side, { edge: number; to: string | null }> {
  const [ha, hb] = halfOf(c);
  const others = model.components.filter((n) => n.id !== c.id && placeOf(n) === placeOf(c));
  const result: Record<Side, { edge: number; to: string | null }> = {
    left: { edge: 0, to: null },
    right: { edge: size[0], to: null },
    front: { edge: 0, to: null },
    back: { edge: size[1], to: null },
  };
  for (const n of others) {
    const [na, nb] = halfOf(n);
    const besideAcross = Math.abs(n.b - c.b) < nb + hb; // in its row, so in the way left or right
    const besideBack = Math.abs(n.a - c.a) < na + ha; // in its column, so in the way front or back
    if (besideAcross && n.a + na <= c.a - ha && n.a + na > result.left.edge) result.left = { edge: n.a + na, to: n.id };
    if (besideAcross && n.a - na >= c.a + ha && n.a - na < result.right.edge) result.right = { edge: n.a - na, to: n.id };
    if (besideBack && n.b + nb <= c.b - hb && n.b + nb > result.front.edge) result.front = { edge: n.b + nb, to: n.id };
    if (besideBack && n.b - nb >= c.b + hb && n.b - nb < result.back.edge) result.back = { edge: n.b - nb, to: n.id };
  }
  return result;
}

export function dimensionsFor(model: SceneModel, id: string): Dimension[] {
  const c = model.components.find((item) => item.id === id);
  const frame = c && frameOf(model, c);
  if (!c || !frame) return [];
  const [ha, hb] = halfOf(c);
  const stop = stops(model, c, frame.size);
  const [low, high] = [c.a - ha, c.a + ha];
  const [near, far] = [c.b - hb, c.b + hb];
  return [
    { side: "left", to: stop.left.to, value: round(low - stop.left.edge), at: frame.point((low + stop.left.edge) / 2, c.b) },
    { side: "right", to: stop.right.to, value: round(stop.right.edge - high), at: frame.point((high + stop.right.edge) / 2, c.b) },
    { side: "front", to: stop.front.to, value: round(near - stop.front.edge), at: frame.point(c.a, (near + stop.front.edge) / 2) },
    { side: "back", to: stop.back.to, value: round(stop.back.edge - far), at: frame.point(c.a, (far + stop.back.edge) / 2) },
  ];
}

// Where the part's centre goes for that side's distance to be `value`, as [a, b].
export function placeForDimension(model: SceneModel, id: string, side: Side, value: number): [number, number] | null {
  const c = model.components.find((item) => item.id === id);
  const frame = c && frameOf(model, c);
  if (!c || !frame) return null;
  const [ha, hb] = halfOf(c);
  const stop = stops(model, c, frame.size);
  if (side === "left") return [round(stop.left.edge + value + ha), c.b];
  if (side === "right") return [round(stop.right.edge - value - ha), c.b];
  if (side === "front") return [c.a, round(stop.front.edge + value + hb)];
  return [c.a, round(stop.back.edge - value - hb)];
}

// Where a part's centre is in the view's space, for finding it on the page.
export function centreOf(model: SceneModel, c: SceneComponent): Point | null {
  if (c.curve && c.surface) {
    const s = c.surface;
    return [c.a, s.y0 + c.b * s.cos, s.z0 + c.b * s.sin];
  }
  return frameOf(model, c)?.point(c.a, c.b) ?? null;
}
