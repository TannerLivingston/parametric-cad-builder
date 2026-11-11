// Handles on the shape for what's selected, to drag rather than type: a seam or the plate's split
// along the width, the walls for the width and depth and the front edge for the front height, a
// surface's crease back and up, a curve's middle for its bulge, and a bowed wall for its bow. And one
// in the middle of a label, hole, vent or something on the plate, to move it across its face.
// Each changes the config from what it was when the drag began, by how far the handle has gone,
// so the validator still judges the result.
import type { RawConfig } from "./configEdit.js";
import { surfacePoint, type Surface } from "../profile.js";
import { nudgeThing } from "./thingKeys.js";
import { WALLS_PATH } from "./pickThing.js";
import type { ShapeHandle } from "./Scene3D.js";
import { setBow, setPlateSplit, setSurfaceBulge, shapeValues, updateEnclosure, updateSeam, updateSurface } from "./shapeEdit.js";

export interface HandleSpec extends ShapeHandle {
  apply(config: RawConfig, delta: number, deltaAcross?: number): RawConfig;
}

// The shape as built, for where a label on a surface is, and the floor.
export interface HandleFrame {
  surfaces: Surface[];
  floorThickness: number;
}

const LIFT = 1; // how far off its face an item's handle sits

const OUT = 6; // how far outside the shell a handle sits, so it's clear of it
const STEP = 0.5; // what a dragged size rounds to
const snap = (value: number) => Math.round(value / STEP) * STEP;

// `joints` is where the plate splits, as the validator chose it if the config doesn't say.
export function handlesFor(config: RawConfig, path: string | null, joints: number[] = [], frame?: HandleFrame): HandleSpec[] {
  if (!path || !config.enclosure) return [];
  const item = itemHandle(config, path, frame);
  if (item) return [item];
  const { enclosure: e, seams } = shapeValues(config);
  const surfaces: RawConfig[] = e.surfaces;
  const depth = Number(surfaces.at(-1)?.y ?? 0);
  const top = Math.max(e.frontHeight, ...surfaces.map((s) => Number(s.z)));
  const middle = depth / 2;

  const seam = /^seams\[(\d+)\]$/.exec(path);
  if (seam) {
    const index = Number(seam[1]);
    const x = seams[index]?.x;
    if (typeof x !== "number") return [];
    return [{ id: path, at: [x, middle, top + OUT], axis: [1, 0, 0], apply: (c, d) => updateSeam(c, index, { x: snap(x + d) }) }];
  }

  if (path === "plate.seamX") {
    return joints.map((x, i) => ({
      id: `${path}[${i}]`,
      at: [x, middle, -OUT],
      axis: [1, 0, 0],
      apply: (c, d) => setPlateSplit(c, joints.map((joint, j) => (j === i ? snap(x + d) : joint))),
    }));
  }

  if (path === WALLS_PATH) {
    const last = surfaces.at(-1);
    const handles: HandleSpec[] = [
      { id: "width", at: [e.width + OUT, middle, e.frontHeight / 2], axis: [1, 0, 0], apply: (c, d) => updateEnclosure(c, { width: snap(e.width + d) }) },
      { id: "frontHeight", at: [-OUT, 0, e.frontHeight], axis: [0, 0, 1], apply: (c, d) => updateEnclosure(c, { frontHeight: snap(e.frontHeight + d) }) },
    ];
    if (last) handles.push({ id: "depth", at: [e.width / 2, depth + OUT, Number(last.z) / 2], axis: [0, 1, 0], apply: (c, d) => updateSurface(c, last.id, { y: snap(depth + d) }) });
    // A bowed wall's bow, from its middle, outward.
    for (const side of ["front", "rear"] as const) {
      const bow = Number(e.bow[side] ?? 0);
      if (bow <= 0) continue;
      const outward = side === "front" ? -1 : 1;
      const y = side === "front" ? -bow : depth + bow;
      const height = side === "front" ? e.frontHeight : Number(last?.z ?? e.frontHeight);
      handles.push({ id: `bow.${side}`, at: [e.width / 2, y + outward * OUT, height / 2], axis: [0, outward, 0], apply: (c, d) => setBow(c, side, snap(bow + d)) });
    }
    return handles;
  }

  const surface = /^enclosure\.surfaces\[(\d+)\]$/.exec(path);
  if (surface) {
    const index = Number(surface[1]);
    const s = surfaces[index];
    if (!s) return [];
    const [y, z] = [Number(s.y), Number(s.z)];
    const [y0, z0] = index === 0 ? [0, e.frontHeight] : [Number(surfaces[index - 1]!.y), Number(surfaces[index - 1]!.z)];
    // Its crease, at the far end, moves back and up, beside the left wall where parts don't get in the way.
    const handles: HandleSpec[] = [
      { id: `${path}.y`, at: [-OUT, y, z], axis: [0, 1, 0], apply: (c, d) => updateSurface(c, s.id, { y: snap(y + d) }) },
      { id: `${path}.z`, at: [-OUT * 2.5, y, z], axis: [0, 0, 1], apply: (c, d) => updateSurface(c, s.id, { z: snap(z + d) }) },
    ];
    // Its curve, from the middle of the arc, square to the line between its ends.
    const length = Math.hypot(y - y0, z - z0);
    if (length > 0) {
      const bulge = Number(s.bulge ?? 0);
      const normal: [number, number] = [-(z - z0) / length, (y - y0) / length];
      const mid: [number, number] = [(y0 + y) / 2 + normal[0] * bulge, (z0 + z) / 2 + normal[1] * bulge];
      handles.push({ id: `${path}.bulge`, at: [-OUT, mid[0], mid[1]], axis: [0, normal[0], normal[1]], apply: (c, d) => setSurfaceBulge(c, s.id, snap(bulge + d) || undefined) });
    }
    return handles;
  }
  return [];
}

// What's on a list, moved across its face by its own two numbers, to the half millimetre.
function itemHandle(config: RawConfig, path: string, frame: HandleFrame | undefined): HandleSpec | null {
  const match = /^(labels|wallHoles|vents|plate\.(?:supports|pins|feet|weights|cableTies|countersunkHoles))\[(\d+)\]$/.exec(path);
  if (!match) return null;
  const list = match[1]!.split(".").reduce<any>((at, key) => at?.[key], config);
  const item: RawConfig | undefined = Array.isArray(list) ? list[Number(match[2])] : undefined;
  if (!item || typeof item.component === "string") return null;
  const { enclosure: e } = shapeValues(config);
  const depth = Number(e.surfaces.at(-1)?.y ?? 0);
  // Moves by however far, rounded so that where it ends up is on the half millimetre.
  const by = (a: number, b: number) => (c: RawConfig, d: number, dAcross = 0) => nudgeThing(c, path, snap(a + d) - a, snap(b + dAcross) - b) ?? c;

  if (typeof item.wall === "string") {
    const { at, z } = item as { at: number; z: number };
    const side = item.wall === "left" || item.wall === "right";
    const x = item.wall === "left" ? -LIFT : item.wall === "right" ? e.width + LIFT : at;
    const y = side ? at : item.wall === "front" ? -LIFT : depth + LIFT;
    return { id: path, at: [x, y, z], axis: side ? [0, 1, 0] : [1, 0, 0], across: [0, 0, 1], apply: by(at, z) };
  }
  if (typeof item.u === "number" || match[1] === "labels") {
    const id = item.surface ?? e.surfaces[0]?.id;
    const surface = frame?.surfaces.find((s) => s.id === id);
    if (!surface) return null;
    const [u, v] = [Number(item.u), Number(item.v)];
    const [y, z] = surfacePoint(surface, v, LIFT);
    return { id: path, at: [u, y, z], axis: [1, 0, 0], across: [0, surface.cos, surface.sin], apply: by(u, v) };
  }
  const [x, y] = [Number(item.x), Number(item.y)];
  // Feet and holes in the plate are seen from below, the rest from above.
  const under = /feet|countersunkHoles/.test(match[1]!);
  const z = under ? -LIFT : (frame?.floorThickness ?? 3) + LIFT;
  return { id: path, at: [x, y, z], axis: [1, 0, 0], across: [0, 1, 0], apply: by(x, y) };
}
