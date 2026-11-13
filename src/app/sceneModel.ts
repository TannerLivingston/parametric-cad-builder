// What the viewport draws for each component, worked out from the config alone. This
// runs on every change, even for invalid layouts, so parts can follow the pointer
// while the engine only ever sees valid plans.
import { textOutline } from "../lettering.js";
import { flatFor } from "../flats.js";
import { configSchema, type Config, type Footprint, type Part } from "../schema.js";
import { footprintShape, gap, halfExtents, type Rotation, type Shape } from "../geometry.js";
import { buildSurfaces, surfacePoint, type Surface } from "../profile.js";
import type { Issue, IssueBox, PlannedFasteners } from "../validate.js";
import { partsOf, type RawConfig } from "./configEdit.js";

export interface Box2 {
  shape: "circle" | "rect";
  // half sizes along u (or x) and v (or y), already rotated
  hu: number;
  hv: number;
}

export interface SceneComponent {
  id: string;
  mount: "panel" | "floor" | "wall";
  a: number; // u or x, or along a wall
  b: number; // v or y, or up a wall
  surface: Surface | null;
  curve?: string; // the curved surface it's on, where `surface` is its own flat let into that
  printedPart: number;
  onTopPanel: boolean;
  above: (Box2 & { height: number }) | null;
  below: (Box2 & { depth: number }) | null;
  floor: (Box2 & { height: number }) | null;
  inWall: { wall: "left" | "right" | "front" | "rear"; face: Box2; body: Box2; depth: number } | null;
}

export interface SceneModel {
  width: number;
  surfaces: Surface[];
  panelThickness: number;
  floorThickness: number;
  wall: number;
  seamXs: number[];
  // The room kept for what an opening holds, from the base up.
  reserved: { xMin: number; xMax: number; yMin: number; yMax: number; top: number }[];
  components: SceneComponent[];
}

function box(footprint: Footprint, rotation: Rotation): Box2 {
  const [hu, hv] = halfExtents(footprintShape(footprint, 0, 0, rotation));
  return { shape: footprint.shape, hu, hv };
}

// Null if the config doesn't parse, in which case the viewport keeps its last model.
export function buildSceneModel(raw: RawConfig): SceneModel | null {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) return null;
  const config: Config = parsed.data;
  const parts = partsOf(parsed.data as RawConfig);
  const surfaces = buildSurfaces(config.enclosure.frontHeight, config.enclosure.surfaces, config.enclosure.panelThickness);
  const seamXs = config.seams.map((s) => s.x).sort((a, b) => a - b);
  const printedPartAt = (x: number) => {
    const index = seamXs.findIndex((seam) => x < seam);
    return index === -1 ? seamXs.length : index;
  };

  const components: SceneComponent[] = [];
  for (const component of config.components) {
    const part: Part | undefined = parts[component.type];
    if (!part) continue;
    const rotation = component.rotationDeg as Rotation;
    const placed = {
      id: component.id,
      printedPart: 0,
      onTopPanel: false,
      above: null,
      below: null,
      floor: null,
      inWall: null,
    };
    if ("u" in component && part.mount === "panel") {
      // On a curve, it sits on the flat let into it there.
      const curve = component.surface ?? surfaces[0]?.curveOf;
      const onCurve = curve !== undefined && surfaces.some((s) => s.curveOf === curve);
      const surface = onCurve
        ? flatFor(surfaces, curve, component, part, config.labels).surface
        : (surfaces.find((s) => s.id === component.surface) ?? surfaces[0] ?? null);
      components.push({
        ...placed,
        mount: "panel",
        a: component.u,
        b: component.v,
        surface,
        ...(onCurve && { curve }),
        printedPart: printedPartAt(component.u),
        onTopPanel: config.topPanels.some((panel) => panel.surface === surface?.id),
        above: { ...box(part.above.footprint, rotation), height: part.above.height },
        below: { ...box(part.below.footprint, rotation), depth: part.below.depth },
      });
    } else if ("x" in component && part.mount === "floor") {
      components.push({
        ...placed,
        mount: "floor",
        a: component.x,
        b: component.y,
        surface: null,
        printedPart: printedPartAt(component.x),
        floor: { ...box(part.footprint, rotation), height: part.height },
      });
    } else if ("wall" in component && part.mount === "wall") {
      const sideways = rotation === 90 || rotation === 270;
      const rect = (width: number, height: number): Box2 => ({ shape: "rect", hu: (sideways ? height : width) / 2, hv: (sideways ? width : height) / 2 });
      const side = component.wall === "left" || component.wall === "right";
      const x = side ? (component.wall === "left" ? 0 : config.enclosure.width) : component.at;
      components.push({
        ...placed,
        mount: "wall",
        a: component.at,
        b: component.z,
        surface: null,
        printedPart: printedPartAt(x),
        inWall: { wall: component.wall, face: rect(part.outside.width, part.outside.height), body: rect(part.body.width, part.body.height), depth: part.body.depth },
      });
    }
  }
  return {
    width: config.enclosure.width,
    surfaces,
    panelThickness: config.enclosure.panelThickness,
    floorThickness: config.enclosure.floorThickness,
    wall: config.enclosure.wall,
    seamXs,
    reserved: config.opening?.keepOut ?? [],
    components,
  };
}

export type SectionAxis = "x" | "y" | "z";

export interface Section {
  axis: SectionAxis;
  at: number;
}

// What a section keeps: a plane's normal and its distance, for keeping the points where
// normal . p + constant >= 0. It keeps the far side from the default view, so the cut faces you.
export function sectionPlane({ axis, at }: Section): { normal: [number, number, number]; constant: number } {
  if (axis === "x") return { normal: [-1, 0, 0], constant: at };
  if (axis === "y") return { normal: [0, 1, 0], constant: -at };
  return { normal: [0, 0, -1], constant: at };
}

// How far a section can go along each axis.
export function sectionRange(model: Pick<SceneModel, "width" | "surfaces">, axis: SectionAxis): [number, number] {
  if (axis === "x") return [0, model.width];
  if (axis === "y") return [0, model.surfaces.at(-1)?.y1 ?? 0];
  return [0, Math.max(0, ...model.surfaces.flatMap((s) => [s.z0, s.z1]))];
}

// Where a world point falls on a surface, the inverse of surfacePoint at normal 0.
export function surfaceCoordinates(surface: Surface, [x, y, z]: readonly [number, number, number]): { u: number; v: number } {
  return { u: x, v: (y - surface.y0) * surface.cos + (z - surface.z0) * surface.sin };
}

// Where a ray meets a curved surface, as u and how far along the curve, for dragging a part over
// it. The curve's first and last short flats carry on past its ends, so a drag can leave it.
export function curveCoordinates(surfaces: Surface[], curve: string, origin: readonly [number, number, number], direction: readonly [number, number, number]): { u: number; v: number } | null {
  const flats = surfaces.filter((s) => s.curveOf === curve);
  let best: { t: number; u: number; v: number } | null = null;
  let passed = 0;
  flats.forEach((s, i) => {
    const facing = -direction[1] * s.sin + direction[2] * s.cos;
    const t = Math.abs(facing) < 1e-9 ? -1 : (-(s.y0 - origin[1]) * s.sin + (s.z0 - origin[2]) * s.cos) / facing;
    const along = (origin[1] + t * direction[1] - s.y0) * s.cos + (origin[2] + t * direction[2] - s.z0) * s.sin;
    const within = (i === 0 || along >= -1e-6) && (i === flats.length - 1 || along <= s.length + 1e-6);
    if (t > 0 && within && (!best || t < best.t)) best = { t, u: origin[0] + t * direction[0], v: passed + along };
    passed += s.length;
  });
  return best && { u: (best as { u: number }).u, v: (best as { v: number }).v };
}

// How far apart printed parts sit when the view separates them.
export function explodeOffset(printedPart: number, partCount: number, gap: number): number {
  return (printedPart - (partCount - 1) / 2) * gap;
}

export function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

// How far a part is from the nearest one around it, by what takes up room at the surface: what stands
// above it, or a board's footprint on the floor.
export function nearestNeighbour(model: SceneModel, id: string): { id: string; gap: number } | null {
  const source = model.components.find((c) => c.id === id);
  if (!source) return null;
  const outline = (c: SceneComponent): Shape => {
    const box = (c.above ?? c.floor ?? c.inWall!.face);
    return box.shape === "circle" ? { kind: "circle", cx: c.a, cy: c.b, r: box.hu } : { kind: "rect", cx: c.a, cy: c.b, w: box.hu * 2, h: box.hv * 2 };
  };
  let nearest: { id: string; gap: number } | null = null;
  for (const other of model.components) {
    if (other.id === id || other.mount !== source.mount || other.surface?.id !== source.surface?.id || other.inWall?.wall !== source.inWall?.wall) continue;
    const between = gap(outline(source), outline(other));
    if (!nearest || between < nearest.gap) nearest = { id: other.id, gap: between };
  }
  return nearest;
}

// Between two picked points, for measuring.
export function measureBetween(a: readonly [number, number, number], b: readonly [number, number, number]) {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  const dz = Math.abs(b[2] - a[2]);
  return { distance: Math.sqrt(dx * dx + dy * dy + dz * dz), dx, dy, dz };
}

const around = (x: number, y: number, z: number, r = 3): IssueBox => ({ min: [x - r, y - r, z - r], max: [x + r, y + r, z + r] });

// Where a problem is, for showing it. Null if it's about the design as a whole.
export function issueSpot(issue: Pick<Issue, "path" | "where">, config: RawConfig, model: SceneModel, fasteners: PlannedFasteners): IssueBox | null {
  if (issue.where) return issue.where;
  const { path } = issue;
  const indexed = (pattern: RegExp) => {
    const match = pattern.exec(path);
    return match ? Number(match[1]) : null;
  };
  const depth = model.surfaces.at(-1)?.y1 ?? 0;
  const height = Math.max(0, ...model.surfaces.flatMap((s) => [s.z0, s.z1]));
  const floor = model.floorThickness;

  const component = indexed(/^components\[(\d+)\]/);
  if (component !== null) {
    const found = model.components.find((c) => c.id === config.components?.[component]?.id);
    if (!found) return null;
    if (found.inWall) {
      const { wall, face } = found.inWall;
      const [x, y] = wall === "left" ? [0, found.a] : wall === "right" ? [model.width, found.a] : [found.a, wall === "front" ? 0 : depth];
      const side = wall === "left" || wall === "right";
      return { min: [side ? x - 2 : x - face.hu, side ? y - face.hu : y - 2, found.b - face.hv], max: [side ? x + 2 : x + face.hu, side ? y + face.hu : y + 2, found.b + face.hv] };
    }
    if (found.mount === "floor") {
      const { hu, hv, height: tall } = found.floor!;
      return { min: [found.a - hu, found.b - hv, floor], max: [found.a + hu, found.b + hv, floor + tall] };
    }
    const [y, z] = surfacePoint(found.surface!, found.b, 0);
    const { hu, hv } = found.below!;
    return { min: [found.a - hu, y - hv, z - found.below!.depth], max: [found.a + hu, y + hv, z + 1] };
  }
  const fastener = fasteners.items.find((f) => f.id === path);
  if (fastener) return around(fastener.x, fastener.y, fastener.z + 4, 5);
  for (const list of ["screws", "countersunkHoles", "pins", "supports", "feet", "weights"]) {
    const at = indexed(new RegExp(`^plate\\.${list}\\[(\\d+)\\]`));
    const spot = at !== null ? config.plate?.[list]?.[at] : null;
    if (spot) return around(spot.x, spot.y, floor, 5);
  }
  const hole = indexed(/^wallHoles\[(\d+)\]/);
  if (hole !== null) {
    const w = config.wallHoles?.[hole];
    if (!w) return null;
    const half = w.width / 2;
    const up = w.height / 2;
    if (w.wall === "left") return { min: [-1, w.at - half, w.z - up], max: [4, w.at + half, w.z + up] };
    if (w.wall === "right") return { min: [model.width - 4, w.at - half, w.z - up], max: [model.width + 1, w.at + half, w.z + up] };
    if (w.wall === "front") return { min: [w.at - half, -1, w.z - up], max: [w.at + half, 4, w.z + up] };
    return { min: [w.at - half, depth - 4, w.z - up], max: [w.at + half, depth + 1, w.z + up] };
  }
  const tie = indexed(/^plate\.cableTies\[(\d+)\]/);
  if (tie !== null) {
    const spot = config.plate?.cableTies?.[tie];
    if (spot) return around(spot.x, spot.y, floor + 2, 6);
  }
  const vent = indexed(/^vents\[(\d+)\]/);
  if (vent !== null) {
    const v = config.vents?.[vent];
    if (!v) return null;
    const [half, up] = [v.width / 2, v.height / 2];
    if (v.wall === "left") return { min: [-1, v.at - half, v.z - up], max: [4, v.at + half, v.z + up] };
    if (v.wall === "right") return { min: [model.width - 4, v.at - half, v.z - up], max: [model.width + 1, v.at + half, v.z + up] };
    if (v.wall === "front") return { min: [v.at - half, -1, v.z - up], max: [v.at + half, 4, v.z + up] };
    return { min: [v.at - half, depth - 4, v.z - up], max: [v.at + half, depth + 1, v.z + up] };
  }
  if (/^seams\[\d+\]/.test(path)) {
    const x = config.seams?.[indexed(/^seams\[(\d+)\]/)!]?.x;
    return typeof x === "number" ? { min: [x - 1, 0, 0], max: [x + 1, depth, height] } : null;
  }
  if (path === "plate.seamX" && typeof config.plate?.seamX === "number") return { min: [config.plate.seamX - 1, 0, 0], max: [config.plate.seamX + 1, depth, floor] };
  const label = indexed(/^labels\[(\d+)\]/);
  if (label !== null) {
    const l = config.labels?.[label];
    if (!l) return null;
    const outline = textOutline(String(l.text ?? ""), Number(l.size ?? 5));
    const turned = l.rotationDeg === 90 || l.rotationDeg === 270;
    const [across, up] = turned ? [outline.height / 2 + 1, outline.width / 2 + 1] : [outline.width / 2 + 1, outline.height / 2 + 1];
    if (typeof l.u === "number") {
      const surface = model.surfaces.find((s) => s.id === l.surface) ?? model.surfaces[0];
      if (!surface || surface.curveOf) return null;
      const [y0, z0] = surfacePoint(surface, l.v - up, 0);
      const [y1, z1] = surfacePoint(surface, l.v + up, 0);
      return { min: [l.u - across, Math.min(y0, y1), Math.min(z0, z1) - 1], max: [l.u + across, Math.max(y0, y1), Math.max(z0, z1) + 1] };
    }
    if (typeof l.wall === "string") {
      if (l.wall === "left") return { min: [-1, l.at - across, l.z - up], max: [2, l.at + across, l.z + up] };
      if (l.wall === "right") return { min: [model.width - 2, l.at - across, l.z - up], max: [model.width + 1, l.at + across, l.z + up] };
      if (l.wall === "front") return { min: [l.at - across, -1, l.z - up], max: [l.at + across, 2, l.z + up] };
      return { min: [l.at - across, depth - 2, l.z - up], max: [l.at + across, depth + 1, l.z + up] };
    }
    return null;
  }
  const surfaceAt = indexed(/^enclosure\.surfaces\[(\d+)\]/);
  if (surfaceAt !== null) {
    // All of a curve's short flats, for a curved one.
    const id = config.enclosure?.surfaces?.[surfaceAt]?.id;
    const own = model.surfaces.filter((s) => s.id === id || s.curveOf === id);
    if (!own.length) return null;
    const zs = own.flatMap((s) => [s.z0, s.z1]);
    return { min: [0, own[0]!.y0, Math.min(...zs) - 1], max: [model.width, own.at(-1)!.y1, Math.max(...zs) + 1] };
  }
  const reserved = indexed(/^opening\.keepOut\[(\d+)\]/);
  if (reserved !== null) {
    const box = config.opening?.keepOut?.[reserved];
    return box ? { min: [box.xMin, box.yMin, 0], max: [box.xMax, box.yMax, box.top] } : null;
  }
  if (path.startsWith("opening") && config.opening) {
    const { xMin, xMax, yEnd, sill } = config.opening;
    return { min: [xMin, 0, sill], max: [xMax, yEnd, height] };
  }
  const panel = indexed(/^topPanels\[(\d+)\]/);
  if (panel !== null) {
    const surface = model.surfaces.find((s) => s.id === config.topPanels?.[panel]?.surface);
    return surface ? { min: [0, surface.y0, Math.min(surface.z0, surface.z1) - surface.thickness], max: [model.width, surface.y1, Math.max(surface.z0, surface.z1)] } : null;
  }
  return null;
}

// The part of the shape one number sizes, to light up while its field has the cursor: the right
// wall for the width, the front edge for the front height, a crease for a surface's depth and
// height, a corner, a round's edge, a bowed wall, a wall's or the floor's thickness, a seam's lip.
// Null for a number that has no one place.
export function fieldSpot(path: string, config: RawConfig, model: SceneModel): IssueBox | null {
  const e = config.enclosure ?? {};
  const width = model.width;
  const depth = model.surfaces.at(-1)?.y1 ?? 0;
  const front = model.surfaces[0]?.z0 ?? 0;
  const rear = model.surfaces.at(-1)?.z1 ?? 0;
  const top = Math.max(0, ...model.surfaces.flatMap((s) => [s.z0, s.z1]));
  const at = (pattern: RegExp) => {
    const match = pattern.exec(path);
    return match ? Number(match[1]) : null;
  };
  if (path === "enclosure.width") return { min: [width - 1, 0, 0], max: [width + 1, depth, top] };
  if (path === "enclosure.frontHeight") return { min: [0, -1, front - 1], max: [width, 1, front + 1] };
  if (path === "enclosure.cornerRadius") {
    const r = Math.max(Number(e.cornerRadius ?? 0), 2);
    return { min: [0, 0, 0], max: [r, r, front] };
  }
  const round = /^enclosure\.rounds\.(frontBottom|rearTop|rearBottom)$/.exec(path)?.[1];
  if (round) {
    const r = Math.max(Number(e.rounds?.[round] ?? 0), 2);
    if (round === "frontBottom") return { min: [0, 0, 0], max: [width, r, r] };
    if (round === "rearTop") return { min: [0, depth - r, rear - r], max: [width, depth, rear] };
    return { min: [0, depth - r, 0], max: [width, depth, r] };
  }
  const bow = /^enclosure\.bow\.(front|rear|left|right)$/.exec(path)?.[1];
  if (bow) {
    const b = Math.max(Number(e.bow?.[bow] ?? 0), 1);
    const high = Math.max(front, rear);
    if (bow === "left") return { min: [-b, 0, 0], max: [0, depth, high] };
    if (bow === "right") return { min: [width, 0, 0], max: [width + b, depth, high] };
    return bow === "front" ? { min: [0, -b, 0], max: [width, 0, front] } : { min: [0, depth, 0], max: [width, depth + b, rear] };
  }
  if (path === "enclosure.wall") return { min: [0, 0, 0], max: [model.wall, depth, Math.min(front, rear)] };
  if (path === "enclosure.floorThickness") return { min: [0, 0, 0], max: [width, depth, model.floorThickness] };
  if (path === "enclosure.panelThickness") {
    const s = model.surfaces[0];
    return s ? { min: [0, s.y0, Math.min(s.z0, s.z1) - model.panelThickness], max: [width, s.y1, Math.max(s.z0, s.z1)] } : null;
  }
  const crease = at(/^enclosure\.surfaces\[(\d+)\]\.[yz]$/);
  if (crease !== null) {
    const id = e.surfaces?.[crease]?.id;
    const own = model.surfaces.filter((s) => s.id === id || s.curveOf === id).at(-1);
    return own ? { min: [0, own.y1 - 1, own.z1 - 1], max: [width, own.y1 + 1, own.z1 + 1] } : null;
  }
  const lip = at(/^seams\[(\d+)\]\.(?:lip|tongue)$/);
  if (lip !== null) {
    const seam = config.seams?.[lip];
    if (!seam) return null;
    const reach = path.endsWith("tongue") ? seam.tongue : seam.lip;
    return { min: [seam.x, 0, 0], max: [seam.x + Math.max(Number(reach ?? 0), 1), depth, top] };
  }
  return null;
}
