// Which way to look at something selected, square onto it: a wall's things from outside that wall,
// a surface's from above it, the plate's from above, or from below for what's under it.
import type { RawConfig } from "./configEdit.js";
import type { SceneModel } from "./sceneModel.js";
import { WALLS_PATH } from "./pickThing.js";

type Direction = [number, number, number];
const WALLS: Record<string, Direction> = { left: [-1, 0, 0], right: [1, 0, 0], front: [0, -1, 0], rear: [0, 1, 0] };
const UP: Direction = [0, 0, 1];
const DOWN: Direction = [0, 0, -1];

// `path` is a config path such as `labels[0]` or `components[3]`. Undefined keeps the view's own direction.
export function facingFor(config: RawConfig, model: SceneModel, path: string): Direction | undefined {
  const surfaceFacing = (id: string | undefined): Direction | undefined => {
    const surface = model.surfaces.find((s) => s.id === id) ?? model.surfaces.find((s) => s.curveOf === id);
    return surface ? [0, -surface.sin, surface.cos] : undefined;
  };
  const indexed = (pattern: RegExp, list: unknown): RawConfig | undefined => {
    const match = pattern.exec(path);
    return match && Array.isArray(list) ? list[Number(match[1])] : undefined;
  };
  const component = indexed(/^components\[(\d+)\]$/, config.components);
  if (component) {
    const placed = model.components.find((c) => c.id === component.id);
    if (placed?.inWall) return WALLS[placed.inWall.wall];
    if (placed?.mount === "floor") return UP;
    return placed?.surface ? [0, -placed.surface.sin, placed.surface.cos] : undefined;
  }
  const onWall = indexed(/^(?:labels|wallHoles|vents)\[(\d+)\]$/, path.startsWith("labels") ? config.labels : path.startsWith("vents") ? config.vents : config.wallHoles);
  if (onWall) {
    if (typeof onWall.wall === "string") return WALLS[onWall.wall];
    if (typeof onWall.component === "string") return undefined;
    return surfaceFacing(onWall.surface ?? config.enclosure?.surfaces?.[0]?.id);
  }
  if (/^plate\.(feet|countersunkHoles)/.test(path) || path === "plate.seamX") return DOWN;
  if (/^plate\./.test(path) || /^opening/.test(path)) return UP;
  const surface = indexed(/^enclosure\.surfaces\[(\d+)\]$/, config.enclosure?.surfaces);
  if (surface) return surfaceFacing(surface.id);
  if (path === WALLS_PATH) return undefined;
  return undefined;
}
