// A flat let into a curved surface for a part to sit on, since a part needs a flat face above and
// below. It's a little panel of the surface's own thickness, set across the curve where the part is:
// sunk into a curve that rises, and standing proud of one that dips, with the underside moved to
// match. Each part on a curve gets its own, just big enough for it.
import { rotateOffset, type Rotation } from "./geometry.js";
import type { Point2, Surface } from "./profile.js";
import type { PanelPart } from "./schema.js";

export const FLAT_MARGIN = 2; // round what the part takes up
export const FLAT_STEP = 0.2; // past the curve at the flat's ends, so that it never just touches it
export const MAX_FLAT_SINK = 4; // how far a flat can be from its curve at the middle

export interface CurveFlat {
  componentId: string;
  curve: string; // the curved surface's id
  surface: Surface; // the flat itself, whose v is the part's own along the curve
  uLow: number;
  uHigh: number;
  vLow: number; // along the curve, where the flat's ends are
  vHigh: number;
  rises: boolean; // whether the curve rises over the flat, so the flat is sunk into it
  sink: number; // how far the flat is from the curve at its middle
}

export const flatId = (curve: string, componentId: string) => `${curve} flat for ${componentId}`;

// How far a part reaches each way from its own origin, across and along, once turned.
export function partReach(part: PanelPart, rotation: Rotation): [number, number] {
  let hu = 0;
  let hv = 0;
  const take = (at: readonly [number, number], width: number, height: number) => {
    for (const corner of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const [u, v] = rotateOffset([at[0] + (corner[0] * width) / 2, at[1] + (corner[1] * height) / 2], rotation);
      hu = Math.max(hu, Math.abs(u));
      hv = Math.max(hv, Math.abs(v));
    }
  };
  const footprint = (shape: PanelPart["above"]["footprint"]) => (shape.shape === "circle" ? ([shape.diameter, shape.diameter] as const) : ([shape.width, shape.height] as const));
  take([0, 0], ...footprint(part.above.footprint));
  take([0, 0], ...footprint(part.below.footprint));
  for (const cutout of part.cutouts) {
    const [width, height] = cutout.kind === "circle" ? [cutout.diameter, cutout.diameter] : [cutout.width, cutout.height];
    take(cutout.at, width, height);
    if (cutout.kind === "rect" && cutout.recess) take(cutout.recess.at, cutout.recess.width, cutout.recess.height);
    if (cutout.kind !== "pocket") for (const notch of cutout.notches ?? []) take(notch.at, notch.width, notch.height);
  }
  for (const post of part.posts) take(post.at, post.diameter, post.diameter);
  return [hu, hv];
}

// How long a curve is, along its short flats.
export function curveLength(surfaces: Surface[], curve: string): number {
  return surfaces.filter((s) => s.curveOf === curve).reduce((sum, s) => sum + s.length, 0);
}

// The point a distance along a curve from its front end, and the points where its flats meet from
// there to another distance.
function along(surfaces: Surface[], curve: string, from: number, to: number): { start: Point2; end: Point2; between: Point2[] } {
  const flats = surfaces.filter((s) => s.curveOf === curve);
  const at = (distance: number): Point2 => {
    let left = distance;
    for (const s of flats) {
      if (left <= s.length || s === flats.at(-1)) return [s.y0 + left * s.cos, s.z0 + left * s.sin];
      left -= s.length;
    }
    return [0, 0];
  };
  const between: Point2[] = [];
  let passed = 0;
  for (const s of flats.slice(0, -1)) {
    passed += s.length;
    if (passed > from && passed < to) between.push([s.y1, s.z1]);
  }
  return { start: at(from), end: at(to), between };
}

// The flat for a part at u and v on a curve, reaching hu and hv each way from it.
export function curveFlat(surfaces: Surface[], curve: string, componentId: string, u: number, v: number, [hu, hv]: [number, number]): CurveFlat {
  const vLow = v - hv - FLAT_MARGIN;
  const vHigh = v + hv + FLAT_MARGIN;
  const { start, end, between } = along(surfaces, curve, vLow, vHigh);
  const dy = end[0] - start[0];
  const dz = end[1] - start[1];
  const chord = Math.sqrt(dy * dy + dz * dz);
  const [cos, sin] = [dy / chord, dz / chord];
  // How far the curve is above the line between the flat's ends, at most, or below it.
  const heights = between.map(([y, z]) => -(y - start[0]) * sin + (z - start[1]) * cos);
  const high = Math.max(0, ...heights);
  const low = Math.min(0, ...heights);
  const rises = high >= -low;
  const shift = rises ? -FLAT_STEP : FLAT_STEP;
  const middle: Point2 = [(start[0] + end[0]) / 2 - shift * sin, (start[1] + end[1]) / 2 + shift * cos];
  const thickness = surfaces.find((s) => s.curveOf === curve)!.thickness;
  const surface: Surface = {
    id: flatId(curve, componentId),
    index: -1,
    y0: middle[0] - v * cos,
    z0: middle[1] - v * sin,
    y1: middle[0] + (chord / 2) * cos,
    z1: middle[1] + (chord / 2) * sin,
    thickness,
    length: v + chord / 2,
    angle: Math.atan2(dz, dy),
    cos,
    sin,
    flatOf: curve,
  };
  return { componentId, curve, surface, uLow: u - hu - FLAT_MARGIN, uHigh: u + hu + FLAT_MARGIN, vLow, vHigh, rises, sink: (rises ? high : -low) + FLAT_STEP };
}
