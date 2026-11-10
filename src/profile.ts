// The enclosure's side profile, in the world's YZ plane. Its top is a chain of flat
// surfaces running from front to rear, so one tilted panel and a deck-plus-panel
// shell are the same thing. The solid is this profile extruded along X.

export type Point2 = [number, number];

export interface Surface {
  id: string;
  index: number;
  y0: number;
  z0: number;
  y1: number;
  z1: number;
  thickness: number; // of its panel, or of the shell's skin under it
  length: number;
  angle: number;
  cos: number;
  sin: number;
  curveOf?: string; // the curved surface this is one short flat of
  flatOf?: string; // the curved surface this is a flat let into, for one part
}

export interface Profile {
  surfaces: Surface[];
  depth: number;
  maxHeight: number;
  outer: Point2[]; // the top outline, front to rear, with any round as a few short lines
  inner: Point2[]; // the underside of the surfaces, from wall to wall, the same way
  lower: Point2[]; // the bottom of the space inside, from wall to wall
  cavity: Point2[]; // the closed space inside the walls, above the floor
  rounds: Rounds;
  rearTangent: number; // how much of the last surface the rear top round takes
  plateFront: number; // where the flat base starts and ends, between any bottom rounds
  plateRear: number;
  flats?: Surface[]; // let into curves for the parts on them, and not part of the chain
  outerPath: PathStep[]; // the closed outlines with their true arcs, for the engine
  cavityPath: PathStep[];
}

export interface Rounds {
  frontBottom: number;
  rearTop: number;
  rearBottom: number;
}

// One step of an outline: to a point, in a straight line or through `via` on an arc.
export interface PathStep {
  to: Point2;
  via?: Point2;
}

export interface SurfaceInput {
  id: string;
  y: number;
  z: number;
  thickness?: number | undefined;
  bulge?: number | undefined; // how far its arc rises above the straight line between its ends
}

export const CURVE_FLATNESS = 0.05; // how far a curve's short flats may cut inside its arc
const CURVE_LEVELS = [2, 5] as const; // halvings: 4 flats at least, 32 at most

// The id of a curved surface's flat, counted from the front.
export const curveFlatId = (id: string, n: number) => `${id} curve ${n + 1}`;

// A curved surface's arc as points from its front to its rear, both included. Halved until the flats
// are close enough to the arc, and without trig: see buildSurfaces.
export function curvePoints(a: Point2, b: Point2, bulge: number): Point2[] {
  const dy = b[0] - a[0];
  const dz = b[1] - a[1];
  const chord = Math.sqrt(dy * dy + dz * dz);
  const rise = Math.abs(bulge);
  const radius = (chord * chord / 4 + rise * rise) / (2 * rise);
  // Towards the arc's middle from the chord's, which is the outward normal for a bulge.
  const toward = bulge - Math.sign(bulge) * radius;
  const center: Point2 = [(a[0] + b[0]) / 2 - (dz / chord) * toward, (a[1] + b[1]) / 2 + (dy / chord) * toward];
  let levels = 0;
  let span = chord;
  let sag = rise;
  while (levels < CURVE_LEVELS[0] || (sag > CURVE_FLATNESS && levels < CURVE_LEVELS[1])) {
    span = Math.sqrt(span * span / 4 + sag * sag);
    sag = radius - Math.sqrt(radius * radius - span * span / 4);
    levels++;
  }
  return [a, ...arcLines(center, radius, a, b, levels)];
}

// How far in from each surface: the same for all, or a surface's own.
export type Inset = number | ((surface: Surface) => number);
const insetOf = (inset: Inset, surface: Surface) => (typeof inset === "number" ? inset : inset(surface));
export const ownThickness = (surface: Surface) => surface.thickness;

export function buildSurfaces(frontHeight: number, inputs: SurfaceInput[], panelThickness = 3): Surface[] {
  let y0 = 0;
  let z0 = frontHeight;
  const surfaces: Surface[] = [];
  const add = (id: string, y: number, z: number, thickness: number, curveOf?: string) => {
    // Division and sqrt give the same bits on every platform, but trig functions don't:
    // Node and Chromium differ in the last bit, which is enough to change a mesh. Anything
    // that shapes the geometry must come from these, so that a config gives identical
    // files everywhere. The angle is only for validation messages and limits.
    const dy = y - y0;
    const dz = z - z0;
    const length = Math.sqrt(dy * dy + dz * dz);
    surfaces.push({
      id,
      index: surfaces.length,
      y0,
      z0,
      y1: y,
      z1: z,
      thickness,
      length,
      angle: Math.atan2(dz, dy),
      cos: dy / length,
      sin: dz / length,
      ...(curveOf === undefined ? {} : { curveOf }),
    });
    y0 = y;
    z0 = z;
  };
  for (const input of inputs) {
    const thickness = input.thickness ?? panelThickness;
    // A curve is a run of short flats, so that everything made for flat surfaces follows it.
    if (input.bulge) {
      const points = curvePoints([y0, z0], [input.y, input.z], input.bulge);
      points.slice(1).forEach(([y, z], n) => add(curveFlatId(input.id, n), n === points.length - 2 ? input.y : y, n === points.length - 2 ? input.z : z, thickness, input.id));
    } else add(input.id, input.y, input.z, thickness);
  }
  return surfaces;
}

// A surface by its id, among the chain's and the flats let into its curves.
export function findSurface(profile: Pick<Profile, "surfaces" | "flats">, id: string | null | undefined): Surface | undefined {
  return profile.surfaces.find((s) => s.id === id) ?? profile.flats?.find((s) => s.id === id);
}

// A point `v` along a surface from its front edge, `normal` mm along its outward normal.
export function surfacePoint(surface: Surface, v: number, normal: number): Point2 {
  return [surface.y0 + v * surface.cos - normal * surface.sin, surface.z0 + v * surface.sin + normal * surface.cos];
}

// The chain of surfaces moved `thickness` inward, trimmed to run from frontY to rearY. A point for
// each end of each surface, so a surface that's wholly past either end has both of its at that end.
// Returns null if a surface in between is too short to survive the offset.
export function offsetChain(surfaces: Surface[], thickness: Inset, frontY: number, rearY: number): Point2[] | null {
  const anchors = surfaces.map((s) => surfacePoint(s, 0, -insetOf(thickness, s)));
  const at = (i: number, y: number): Point2 => {
    const s = surfaces[i]!;
    const [py, pz] = anchors[i]!;
    return [y, pz + ((y - py) * s.sin) / s.cos];
  };
  const count = surfaces.length;
  const joints: Point2[] = [];
  for (let i = 0; i < count - 1; i++) {
    const a = surfaces[i]!;
    const b = surfaces[i + 1]!;
    const [ay, az] = anchors[i]!;
    const [by, bz] = anchors[i + 1]!;
    const denominator = a.cos * b.sin - a.sin * b.cos;
    const t = ((by - ay) * b.sin - (bz - az) * b.cos) / denominator;
    joints.push([ay + t * a.cos, az + t * a.sin]);
  }
  // The surfaces that the two ends fall on.
  let first = 0;
  while (first < count - 1 && joints[first]![0] <= frontY) first++;
  let last = count - 1;
  while (last > 0 && joints[last - 1]![0] >= rearY) last--;
  if (first > last) return null;
  const front = at(first, frontY);
  const rear = at(last, rearY);
  const points: Point2[] = [];
  for (let i = 0; i <= count; i++) points.push(i <= first ? front : i > last ? rear : joints[i - 1]!);
  for (let i = first; i <= last; i++) {
    const s = surfaces[i]!;
    const [y0, z0] = points[i]!;
    const [y1, z1] = points[i + 1]!;
    if ((y1 - y0) * s.cos + (z1 - z0) * s.sin <= 1e-6) return null;
  }
  return points;
}

// A chain without the points that repeat the one before, which a trimmed chain can have.
export function distinct(chain: Point2[]): Point2[] {
  return chain.filter(([y, z], i) => i === 0 || y !== chain[i - 1]![0] || z !== chain[i - 1]![1]);
}

// Height of a chain at a world y, holding its end values beyond either end.
export function chainHeight(chain: Point2[], y: number): number {
  if (y <= chain[0]![0]) return chain[0]![1];
  for (let i = 0; i < chain.length - 1; i++) {
    const [y0, z0] = chain[i]!;
    const [y1, z1] = chain[i + 1]!;
    if (y <= y1) return z0 + ((y - y0) * (z1 - z0)) / (y1 - y0);
  }
  return chain.at(-1)![1];
}

// The lowest point of a chain between two world ys, which may be at a crease.
export function lowestHeight(chain: Point2[], y0: number, y1: number): number {
  const heights = [chainHeight(chain, y0), chainHeight(chain, y1)];
  for (const [y, z] of chain) if (y > y0 && y < y1) heights.push(z);
  return Math.min(...heights);
}

// The point on an arc halfway between two others, without trig: see buildSurfaces.
function arcMiddle(center: Point2, radius: number, a: Point2, b: Point2): Point2 {
  const dy = (a[0] + b[0]) / 2 - center[0];
  const dz = (a[1] + b[1]) / 2 - center[1];
  const length = Math.sqrt(dy * dy + dz * dz);
  return [center[0] + (dy / length) * radius, center[1] + (dz / length) * radius];
}

// An arc as short lines, including its end but not its start. The lines cut inside a
// curve, so a space bounded by them comes out slightly smaller than it really is.
function arcLines(center: Point2, radius: number, a: Point2, b: Point2, levels = 3): Point2[] {
  if (levels === 0) return [b];
  const middle = arcMiddle(center, radius, a, b);
  return [...arcLines(center, radius, a, middle, levels - 1), ...arcLines(center, radius, middle, b, levels - 1)];
}

// Where a round starts on a surface sloping into a vertical rear wall, how far back from the
// corner. This is radius x tan(half the turn), from the slope's own direction.
export function rearTangentLength(surface: Pick<Surface, "cos" | "sin">, radius: number): number {
  return (radius * surface.cos) / (1 - surface.sin);
}

interface RearRound {
  start: Point2;
  end: Point2;
  center: Point2;
  radius: number;
}

// A round between the last surface's line, through `corner`, and the wall below that corner.
function rearRound(surface: Surface, corner: Point2, radius: number): RearRound {
  const tangent = rearTangentLength(surface, radius);
  return {
    start: [corner[0] - surface.cos * tangent, corner[1] - surface.sin * tangent],
    end: [corner[0], corner[1] - tangent],
    center: [corner[0] - radius, corner[1] - tangent],
    radius,
  };
}

const NO_ROUNDS: Rounds = { frontBottom: 0, rearTop: 0, rearBottom: 0 };

export function buildProfile(
  surfaces: Surface[],
  { wall, panelThickness = ownThickness, floorThickness, rounds = NO_ROUNDS }: { wall: number; panelThickness?: Inset; floorThickness: number; rounds?: Rounds },
): Profile | null {
  const last = surfaces.at(-1)!;
  const depth = last.y1;
  const trimmed = offsetChain(surfaces, panelThickness, wall, depth - wall);
  if (!trimmed) return null;
  const chain = distinct(trimmed);
  const { frontBottom: rf, rearTop: rt, rearBottom: rb } = rounds;
  const frontZ = surfaces[0]!.z0;
  const corner: Point2 = [depth, last.z1];

  // The top of the outside and of the space inside.
  const outerRound = rt > 0 ? rearRound(last, corner, rt) : null;
  const innerRound = rt > 0 ? rearRound(last, chain.at(-1)!, Math.max(rt - wall, 0.5)) : null;
  const sharpTop: Point2[] = [[0, frontZ], ...surfaces.map((s): Point2 => [s.y1, s.z1])];
  const outer = outerRound ? [...sharpTop.slice(0, -1), outerRound.start, ...arcLines(outerRound.center, rt, outerRound.start, outerRound.end)] : sharpTop;
  const inner = innerRound ? [...chain.slice(0, -1), innerRound.start, ...arcLines(innerRound.center, innerRound.radius, innerRound.start, innerRound.end)] : chain;

  // The bottom of the space inside. The base is flat between any bottom rounds.
  const frontLow: Point2[] = rf > 0 ? [[wall, rf], ...arcLines([rf, rf], rf - wall, [wall, rf], [rf, wall])] : [];
  const rearLow: Point2[] = rb > 0 ? [[depth - rb, wall], ...arcLines([depth - rb, rb], rb - wall, [depth - rb, wall], [depth - wall, rb])] : [];
  const plateFront = rf > 0 ? rf : wall;
  const plateRear = rb > 0 ? depth - rb : depth - wall;
  const floorLine: Point2[] = [[plateFront, floorThickness], [plateRear, floorThickness]];
  const lower: Point2[] = [...frontLow, ...floorLine, ...rearLow];

  const step = (to: Point2): PathStep => ({ to });
  // Each outline starts from its own last point.
  const outerPath: PathStep[] = [
    ...(rf > 0 ? [] : [step([0, 0])]),
    step(rb > 0 ? [depth - rb, 0] : [depth, 0]),
    ...(rb > 0 ? [{ to: [depth, rb] as Point2, via: arcMiddle([depth - rb, rb], rb, [depth - rb, 0], [depth, rb]) }] : []),
    ...(outerRound
      ? [step(outerRound.end), { to: outerRound.start, via: arcMiddle(outerRound.center, rt, outerRound.end, outerRound.start) }]
      : [step(corner)]),
    ...[...sharpTop.slice(0, -1)].reverse().map(step),
    ...(rf > 0 ? [step([0, rf]), { to: [rf, 0] as Point2, via: arcMiddle([rf, rf], rf, [0, rf], [rf, 0]) }] : []),
  ];
  // Open at the bottom, between any lips left by bottom rounds.
  const cavityPath: PathStep[] = [
    step([rf > 0 ? rf : wall, -1]),
    step([rb > 0 ? depth - rb : depth - wall, -1]),
    ...(rb > 0
      ? [step([depth - rb, wall]), { to: [depth - wall, rb] as Point2, via: arcMiddle([depth - rb, rb], rb - wall, [depth - rb, wall], [depth - wall, rb]) }]
      : []),
    ...(innerRound
      ? [step(innerRound.end), { to: innerRound.start, via: arcMiddle(innerRound.center, innerRound.radius, innerRound.end, innerRound.start) }]
      : [step(chain.at(-1)!)]),
    ...[...chain.slice(0, -1)].reverse().map(step),
    ...(rf > 0 ? [step([wall, rf]), { to: [rf, wall] as Point2, via: arcMiddle([rf, rf], rf - wall, [wall, rf], [rf, wall]) }] : []),
  ];

  return {
    surfaces,
    depth,
    maxHeight: Math.max(...outer.map(([, z]) => z)),
    outer,
    inner,
    lower,
    cavity: [...lower, ...[...inner].reverse()],
    rounds,
    rearTangent: rt > 0 ? rearTangentLength(last, rt) : 0,
    plateFront,
    plateRear,
    outerPath,
    cavityPath,
  };
}

// How far front and rear the space inside reaches for the whole of a band of heights, which bottom
// rounds narrow. Sampled, so it's within a quarter of a millimetre.
export function cavitySpan(cavity: Point2[], zLow: number, zHigh: number): [number, number] {
  let front = -Infinity;
  let rear = Infinity;
  const steps = Math.max(1, Math.ceil((zHigh - zLow) / 0.25));
  for (let i = 0; i <= steps; i++) {
    const z = zLow + ((zHigh - zLow) * i) / steps;
    const ys: number[] = [];
    cavity.forEach(([y0, z0], k) => {
      const [y1, z1] = cavity[(k + 1) % cavity.length]!;
      if ((z0 - z) * (z1 - z) <= 0 && z0 !== z1) ys.push(y0 + ((z - z0) * (y1 - y0)) / (z1 - z0));
    });
    if (ys.length < 2) return [0, 0];
    front = Math.max(front, Math.min(...ys));
    rear = Math.min(rear, Math.max(...ys));
  }
  return [front, rear];
}

// The highest the bottom of the space inside gets between two world ys.
export function highestFloor(lower: Point2[], y0: number, y1: number): number {
  const heights = [chainHeight(lower, y0), chainHeight(lower, y1)];
  for (const [y, z] of lower) if (y > y0 && y < y1) heights.push(z);
  return Math.max(...heights);
}

// A bolted tab joining the shell's halves. Its sides slope back to the wall at 45
// degrees, so it prints without support when the seam faces up. In the side view it's a
// strip along the wall: `start` to `end` on the wall, reaching `width` along `inward`.
export interface SeamTab {
  start: Point2;
  end: Point2;
  inward: Point2;
  width: number;
  surface: string | null; // the surface it hangs from, or null for a wall
}

export interface SeamFasteners {
  bolts: Point2[];
  pins: Point2[];
  tabs: SeamTab[];
}

const LEG_END_MARGIN = 6; // from a bolt to the bottom edge or the panel above
const LEG_FOOT_MARGIN = 3.5; // from a bolt down to the end of a tab
const BOLT_TO_PIN = 4.9; // M3 clearance radius + pin radius + a thin web
const TAB_LENGTH = 12;
const TAB_PAD = 6; // from a bolt to the end of a tab
const TAB_SEARCH_STEP = 2;
const BOLT_HEAD_ROOM = 3.5; // along the floor from a bolt, which has to be clear of a round

export function tabSection(tab: SeamTab): Point2[] {
  const reach = (point: Point2): Point2 => [point[0] + tab.inward[0] * tab.width, point[1] + tab.inward[1] * tab.width];
  return [tab.start, tab.end, reach(tab.end), reach(tab.start)];
}

// Fasteners that hold a seam together, sized to fit the height available. There's a tab on
// each end wall, plus one under each long enough surface, wherever `isBlocked` allows. Returns
// null if an end wall is too short to take a bolt and a pin.
export function layoutSeamFasteners(
  surfaces: Surface[],
  inner: Point2[],
  { wall, panelThickness = ownThickness, ribWidth, ribBase = 0, lower, rearTangent = 0 }: { wall: number; panelThickness?: Inset; ribWidth: number; ribBase?: number; lower?: Point2[] | undefined; rearTangent?: number },
  isBlocked: (tab: SeamTab) => boolean = () => false,
  isWallGone: (tab: SeamTab) => boolean = () => false,
): SeamFasteners | null {
  const depth = surfaces.at(-1)!.y1;
  const bolts: Point2[] = [];
  const pins: Point2[] = [];
  const tabs: SeamTab[] = [];
  const boltReach = ribWidth / 2;

  for (const [endWallY, direction] of [[wall, 1], [depth - wall, -1]] as const) {
    // Where a round takes the room at the wall, the tab moves in along the floor and hangs
    // between the round's lower and upper parts, as far as it takes to fit a bolt and a pin.
    let wallY: number = endWallY;
    let y = wallY + direction * boltReach;
    let ceiling = Math.min(chainHeight(inner, wallY), chainHeight(inner, y));
    let low = Math.max(LEG_END_MARGIN, ribBase + LEG_FOOT_MARGIN);
    let high = ceiling - LEG_END_MARGIN;
    let attachedAtWall = true;
    if (lower) {
      // The first spot with room for two bolts and a pin, or else the first for one and a pin.
      let found: { candidate: number; boltY: number; roof: number; lowest: number; shift: number } | null = null;
      for (let shift = 0; shift <= 60; shift += 1) {
        const candidate = endWallY + direction * shift;
        const boltY = candidate + direction * boltReach;
        const roof = lowestHeight(inner, boltY - BOLT_HEAD_ROOM, boltY + BOLT_HEAD_ROOM);
        const base = highestFloor(lower, boltY - BOLT_HEAD_ROOM, boltY + BOLT_HEAD_ROOM);
        const lowest = Math.max(LEG_END_MARGIN, ribBase + LEG_FOOT_MARGIN, base + LEG_END_MARGIN);
        const available = roof - LEG_END_MARGIN - lowest;
        if (available < BOLT_TO_PIN) continue;
        found ??= { candidate, boltY, roof, lowest, shift };
        if (available >= 2 * BOLT_TO_PIN) {
          found = { candidate, boltY, roof, lowest, shift };
          break;
        }
      }
      if (found) {
        wallY = found.candidate;
        y = found.boltY;
        ceiling = found.roof;
        low = found.lowest;
        high = found.roof - LEG_END_MARGIN;
        attachedAtWall = found.shift === 0;
      }
    }
    const room = high - low;
    if (room < BOLT_TO_PIN) return null;
    // Trimmed to the shell when built, so a moved tab can run into the round at each end.
    const start: Point2 = [wallY, attachedAtWall ? ribBase : Math.max(ribBase, chainHeight(lower ?? [[0, 0]], wallY) - 2)];
    const end: Point2 = [wallY, attachedAtWall ? Math.min(high + TAB_PAD, ceiling) : chainHeight(inner, wallY) + 2];
    const wallTab: SeamTab = { start, end, inward: [direction, 0], width: ribWidth, surface: null };
    // An opening can take away a wall, and the seam then relies on the other one.
    if (isWallGone(wallTab)) continue;
    bolts.push([y, low]);
    if (room >= 2 * BOLT_TO_PIN) {
      bolts.push([y, high]);
      pins.push([y, (low + high) / 2]);
    } else {
      pins.push([y, high]);
    }
    tabs.push(wallTab);
  }

  const wallTabs = [...tabs];
  const spanY = (tab: SeamTab): [number, number] => {
    const ys = tabSection(tab).map(([y]) => y);
    return [Math.min(...ys), Math.max(...ys)];
  };

  // Under long surfaces, starting from the middle and moving out until a spot is clear.
  const underside = offsetChain(surfaces, panelThickness, wall + ribWidth, depth - wall - ribWidth);
  if (!underside) return null;
  for (let i = 0; i < underside.length - 1; i++) {
    const surface = surfaces[i]!;
    const [y0, z0] = underside[i]!;
    const [y1, z1] = underside[i + 1]!;
    // A tab can only hang from the flat part of a surface that ends in a round.
    const run = Math.hypot(y1 - y0, z1 - z0) - (i === underside.length - 2 ? rearTangent : 0);
    if (run < 30) continue;
    const inward: Point2 = [surface.sin, -surface.cos];
    const pointAt = (distance: number): Point2 => [y0 + surface.cos * distance, z0 + surface.sin * distance];
    const place = (distance: number) => {
      const start = pointAt(distance - TAB_LENGTH / 2);
      const end = pointAt(distance + TAB_LENGTH / 2);
      const tab: SeamTab = { start, end, inward, width: ribWidth, surface: surface.id };
      // A round can move a wall tab in under here, and their bolts would run into each other.
      const [yLow, yHigh] = spanY(tab);
      if (wallTabs.some((other) => spanY(other)[0] < yHigh && spanY(other)[1] > yLow)) return false;
      if (isBlocked(tab)) return false;
      tabs.push(tab);
      const [cy, cz] = pointAt(distance);
      bolts.push([cy + inward[0] * boltReach, cz + inward[1] * boltReach]);
        return true;
    };
    const search = (target: number, reach: number) => {
      for (let offset = 0; offset <= reach; offset += TAB_SEARCH_STEP) {
        for (const sign of offset === 0 ? [1] : [1, -1]) {
          const distance = target + sign * offset;
          if (distance - TAB_LENGTH / 2 >= 0 && distance + TAB_LENGTH / 2 <= run && place(distance)) return;
        }
      }
    };
    for (const t of run >= 100 ? [1 / 3, 2 / 3] : [1 / 2]) search(run * t, (run * (run >= 100 ? 1 / 6 : 1 / 2)));
  }
  if (tabs.length === 0) return null;
  return { bolts, pins, tabs };
}
