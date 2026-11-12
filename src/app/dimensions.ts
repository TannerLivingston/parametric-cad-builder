// The distances from a selected part to the edges of where it sits, shown in the view beside it, to
// click and type what each should be. On a top surface: to its left and right ends and its front
// and back edges. On the floor: to the walls. In a wall: to its ends, the bottom and the top.
import type { SceneComponent, SceneModel } from "./sceneModel.js";

export type Side = "left" | "right" | "front" | "back";

export interface Dimension {
  side: Side;
  value: number; // mm from the part's edge to that edge
  at: [number, number, number]; // where to show it, halfway across the gap
}

type Point = [number, number, number];
const LIFT = 1;

// Where a and b are on the part's surface, floor or wall, and how far each runs.
function frameOf(model: SceneModel, c: SceneComponent): { point(a: number, b: number): Point; size: [number, number] } | null {
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

export function dimensionsFor(model: SceneModel, id: string): Dimension[] {
  const c = model.components.find((item) => item.id === id);
  const frame = c && frameOf(model, c);
  if (!c || !frame) return [];
  const [ha, hb] = halfOf(c);
  const [width, length] = frame.size;
  const [low, high] = [c.a - ha, c.a + ha];
  const [near, far] = [c.b - hb, c.b + hb];
  return [
    { side: "left", value: round(low), at: frame.point(low / 2, c.b) },
    { side: "right", value: round(width - high), at: frame.point((high + width) / 2, c.b) },
    { side: "front", value: round(near), at: frame.point(c.a, near / 2) },
    { side: "back", value: round(length - far), at: frame.point(c.a, (far + length) / 2) },
  ];
}

// Where the part's centre goes for that side's distance to be `value`, as [a, b].
export function placeForDimension(model: SceneModel, id: string, side: Side, value: number): [number, number] | null {
  const c = model.components.find((item) => item.id === id);
  const frame = c && frameOf(model, c);
  if (!c || !frame) return null;
  const [ha, hb] = halfOf(c);
  const [width, length] = frame.size;
  if (side === "left") return [round(value + ha), c.b];
  if (side === "right") return [round(width - value - ha), c.b];
  if (side === "front") return [c.a, round(value + hb)];
  return [c.a, round(length - value - hb)];
}
