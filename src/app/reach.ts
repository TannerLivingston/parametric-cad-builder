// Where a part can't go on its surface or the floor: a grid of spots, each checked by moving just
// that part there and asking the validator whether the part has a problem of its own. It's worked
// through a little at a time, so the app stays responsive, and shaded while the part is dragged.
import { validateConfig } from "../validate.js";
import type { RawConfig } from "./configEdit.js";
import { frameOf } from "./dimensions.js";
import type { SceneModel } from "./sceneModel.js";

export const REACH_STEP = 6; // mm between the spots checked

export interface Cell {
  a: number;
  b: number;
  ok: boolean;
}

type Point = [number, number, number];

// The spots to check, as a generator that yields each one's answer, or nothing for a part that
// isn't on a flat surface or the floor.
export function* reachCells(config: RawConfig, model: SceneModel, id: string, step = REACH_STEP): Generator<Cell> {
  const placed = model.components.find((c) => c.id === id);
  const frame = placed && !placed.inWall && !placed.curve ? frameOf(model, placed) : null;
  const components: RawConfig[] = config.components ?? [];
  const original = components.find((c) => c.id === id);
  if (!placed || !frame || !original) return;
  const [width, length] = frame.size;
  const keys = "x" in original ? ["x", "y"] : ["u", "v"];
  for (let b = step / 2; b < length; b += step) {
    for (let a = step / 2; a < width; a += step) {
      const moved = { ...config, components: components.map((c) => (c.id === id ? { ...c, [keys[0]!]: a, [keys[1]!]: b } : c)) };
      const result = validateConfig(moved, { wiring: false });
      const ok = result.ok || !result.errors.some((issue) => issue.componentIds.includes(id));
      yield { a, b, ok };
    }
  }
}

// The refused spots as squares on the part's surface or the floor, for the view to shade.
export function refusedSquares(model: SceneModel, id: string, cells: Cell[], step = REACH_STEP): [Point, Point, Point, Point][] {
  const placed = model.components.find((c) => c.id === id);
  const frame = placed ? frameOf(model, placed) : null;
  if (!frame) return [];
  const h = step / 2;
  return cells
    .filter((cell) => !cell.ok)
    .map(({ a, b }) => [frame.point(a - h, b - h), frame.point(a + h, b - h), frame.point(a + h, b + h), frame.point(a - h, b + h)]);
}
