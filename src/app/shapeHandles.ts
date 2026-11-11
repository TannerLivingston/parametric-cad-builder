// Handles on the shape for what's selected, to drag rather than type: a seam or the plate's split
// along the width, the walls for the width and depth and the front edge for the front height, a
// surface's crease back and up, a curve's middle for its bulge, and a bowed wall for its bow.
// Each changes the config from what it was when the drag began, by how far the handle has gone,
// so the validator still judges the result.
import type { RawConfig } from "./configEdit.js";
import { WALLS_PATH } from "./pickThing.js";
import type { ShapeHandle } from "./Scene3D.js";
import { setBow, setPlateSplit, setSurfaceBulge, shapeValues, updateEnclosure, updateSeam, updateSurface } from "./shapeEdit.js";

export interface HandleSpec extends ShapeHandle {
  apply(config: RawConfig, delta: number): RawConfig;
}

const OUT = 6; // how far outside the shell a handle sits, so it's clear of it
const STEP = 0.5; // what a dragged size rounds to
const snap = (value: number) => Math.round(value / STEP) * STEP;

// `joints` is where the plate splits, as the validator chose it if the config doesn't say.
export function handlesFor(config: RawConfig, path: string | null, joints: number[] = []): HandleSpec[] {
  if (!path || !config.enclosure) return [];
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
