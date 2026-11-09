// The bottom plate and the screws that hold it. The sizes are from the real Desk Synth: M3
// heat-set inserts in 4 x 6 mm holes, with flat-head screws through countersunk holes.
// The plate's joint sits away from the shell's seam, so the plate ties the halves together.
import { gap, halfExtents, polygonsOverlap, type Shape } from "./geometry.js";
import { cavitySpan, lowestHeight, surfacePoint, type Point2, type Profile, type Surface } from "./profile.js";

export const BOSS_DIAMETER = 8;
export const INSERT_HOLE_DIAMETER = 4;
export const PIN_DIAMETER = 4; // locating a seam
export const PIN_SOCKET_DIAMETER = 4.3;
export const INSERT_HOLE_DEPTH = 6;
export const SCREW_CLEARANCE_DIAMETER = 3.4;
export const COUNTERSINK_DIAMETER = 6.32;
export const COUNTERSINK_DEPTH = 1.6;
export const SHORT_BOSS_HEIGHT = INSERT_HOLE_DEPTH + 2;
const BOSS_RADIUS = BOSS_DIAMETER / 2;
const BOSS_INTO_WALL = 0.5; // so a boss merges with the wall beside it
const INSERT_ROOF = 1; // plastic above an insert hole
const SCREW_EDGE_MARGIN = 3.3; // just past the countersink, which is what lets a boss touch the wall
const PREFERRED_PLATE_JOINT_OFFSET = 60;
const CLOSEST_PLATE_JOINT_OFFSET = 15;
const PLATE_JOINT_OFFSET_STEP = 5;
const SEARCH_STEP = 2;
export const MIN_SCREW_SPACING = 20;
export const SUPPORT_GAP = 0.3; // under what a support holds up, so the plate still goes on easily
const MIN_SUPPORT_HEIGHT = 2;
// What has to pass along a screw's path to drive it: its head, and the shaft of a driver. An M3
// head is 5.5 mm, and a PH1 shaft about 5 mm. Seam bolts are driven sideways from inside the
// shell, so they need room for a whole stubby driver, handle included.
export const DRIVER_DIAMETER = 6;
export const SEAM_DRIVER_ROOM = 60;
const DRIVER_RADIUS = DRIVER_DIAMETER / 2;
const GUSSET_TOUCH_MARGIN = 0.3;

// The line a driver takes to a seam bolt, along x.
export interface SeamDriverPath {
  xLow: number;
  xHigh: number;
  y: number;
  z: number;
}

// A boss on the front or rear wall prints lying on its side, so it slopes back to the wall
// at 45 degrees along x, either side of its circle. This is that outline, at the wall's
// inner face, or null for a boss that isn't on either wall.
export function bossSlope(input: Pick<PlatePlanInput, "wall" | "depth" | "plateFront" | "plateRear" | "slopeFront" | "slopeRear">, x: number, y: number): Point2[] | null {
  const r = BOSS_RADIUS;
  const front = y - r <= (input.plateFront ?? input.wall);
  if (!front && y + r < (input.plateRear ?? input.depth - input.wall)) return null;
  const c = r * Math.SQRT1_2;
  const wallY = front ? (input.slopeFront ?? input.wall - BOSS_INTO_WALL) : (input.slopeRear ?? input.depth - input.wall + BOSS_INTO_WALL);
  const tangentY = front ? y + c : y - c;
  const reach = c + Math.abs(wallY - tangentY);
  return [[x - reach, wallY], [x - c, tangentY], [x + c, tangentY], [x + reach, wallY]];
}

// How far a boss reaches either way along x, somewhere between two world ys. Its slopes
// get wider towards the wall, and away from the wall it's only its circle.
function bossReach(input: PlatePlanInput, x: number, y: number, yLow = -Infinity, yHigh = Infinity): number {
  const slope = bossSlope(input, x, y);
  if (!slope) return BOSS_RADIUS;
  const [wallPoint, tangent] = slope;
  const towardsWall = Math.sign(wallPoint![1] - tangent![1]);
  const closest = towardsWall < 0 ? Math.max(yLow, wallPoint![1]) : Math.min(yHigh, wallPoint![1]);
  const past = (closest - tangent![1]) * towardsWall;
  const c = BOSS_RADIUS * Math.SQRT1_2;
  return past <= 0 ? BOSS_RADIUS : Math.max(BOSS_RADIUS, c + past);
}

export interface PlatePlanInput {
  width: number;
  depth: number;
  wall: number;
  cornerRadius: number;
  floorThickness: number;
  clearance: number;
  // Where the plate starts and ends, if bottom rounds move them from just inside the walls.
  plateFront?: number;
  plateRear?: number;
  // How far a short boss's slopes have to reach to meet a bottom round.
  slopeFront?: number;
  slopeRear?: number;
}

export interface PlatePiece {
  xMin: number;
  xMax: number;
}

// A round hole or body seen from above. Its axis runs straight across the plate in y, at x, from
// yLow to yHigh, so all of it lies within r of that line, however its surface slopes.
export interface Round {
  x: number;
  yLow: number;
  yHigh: number;
  r: number;
}

// How far a point is from a round hole or body seen from above. A lower bound, so a column at
// least this far off is clear of it at any height.
export function roundGap(round: Round, x: number, y: number): number {
  return Math.hypot(x - round.x, Math.max(round.yLow - y, y - round.yHigh, 0)) - round.r;
}

// The same, to the nearest edge of a shape.
export function roundGapTo(round: Round, shape: Shape): number {
  if (shape.kind === "circle") return roundGap(round, shape.cx, shape.cy) - shape.r;
  const dx = Math.max(Math.abs(round.x - shape.cx) - shape.w / 2, 0);
  const dy = Math.max(round.yLow - (shape.cy + shape.h / 2), shape.cy - shape.h / 2 - round.yHigh, 0);
  return Math.hypot(dx, dy) - round.r;
}

export interface BossObstacles {
  ribs: { x: number; half: number; tabs?: { yLow: number; yHigh: number; zLow: number }[] }[];
  joints: number[]; // where the plate splits, left to right
  onSide: boolean; // the shell prints on its side
  capped: [number, number][]; // the y ranges with a separate top panel above them
  posts: { xLow: number; xHigh: number; yLow: number; yHigh: number; zLow?: number }[]; // room kept clear from zLow up
  plateNotch: { xLow: number; xHigh: number; yHigh: number } | null;
  floorParts: Shape[];
  cutouts: { xLow: number; xHigh: number; yLow: number; yHigh: number; round?: Round }[];
  keepOut: { xLow: number; xHigh: number; yLow: number; yHigh: number }[];
  bodies: { xLow: number; xHigh: number; section: Point2[]; round?: Round }[];
  minWeb: number;
  partClearance: number;
  // A top screw is driven up from below with the plate off, past anything fixed to the shell.
  driverColumns?: { x: number; y: number }[];
  gussets?: { xLow: number; xHigh: number; yLow: number; yHigh: number; zLow: number; zHigh: number }[];
  seamPaths?: SeamDriverPath[];
}

// Picks where the plate is split, if the bed can't take it whole: as few joints as fit it, each
// off one of the shell's seams so the plate ties its pieces together, and each piece has to fit,
// which on a wide enclosure means coming closer to a seam. With no seams, it's split evenly.
export function choosePlateJoints(input: PlatePlanInput, seamXs: number[], longestBed: number, minPiece: number): number[] {
  const plateWidth = input.width - 2 * (input.wall + input.clearance);
  if (plateWidth <= longestBed) return [];
  const seams = [...seamXs].sort((a, b) => a - b);
  if (seams.length === 0) {
    const pieces = Math.ceil(plateWidth / longestBed);
    return Array.from({ length: pieces - 1 }, (_, i) => input.wall + input.clearance + (plateWidth * (i + 1)) / pieces);
  }
  const candidates = (seamX: number) => {
    const list: number[] = [];
    for (let offset = PREFERRED_PLATE_JOINT_OFFSET; offset >= CLOSEST_PLATE_JOINT_OFFSET; offset -= PLATE_JOINT_OFFSET_STEP) list.push(seamX - offset, seamX + offset);
    return list;
  };
  const fits = (from: number, to: number) => to - from <= longestBed && to - from >= minPiece;
  const end = input.width - input.wall;
  // Left to right through the chosen seams, each joint fitting the piece it closes.
  const search = (chosen: number[], from: number): number[] | null => {
    if (chosen.length === 0) return fits(from, end) ? [] : null;
    for (const x of candidates(chosen[0]!)) {
      if (!fits(from, x)) continue;
      const rest = search(chosen.slice(1), x);
      if (rest) return [x, ...rest];
    }
    return null;
  };
  const subsets = (size: number, start = 0): number[][] =>
    size === 0 ? [[]] : seams.slice(start).flatMap((seam, i) => subsets(size - 1, start + i + 1).map((rest) => [seam, ...rest]));
  for (let size = 1; size <= seams.length; size++) {
    for (const chosen of subsets(size)) {
      const found = search(chosen, input.wall);
      if (found) return found;
    }
  }
  // Nothing fits, so the closest to the seams it can be, and the validator says what's too big.
  return seams.map((seam) => candidates(seam)[0]!);
}

// Whether two xs are on the same piece of a plate split at `joints`.
export function samePlatePiece(joints: number[], a: number, b: number): boolean {
  return joints.every((joint) => a < joint === b < joint);
}

function insidePlate(input: PlatePlanInput, x: number, y: number, joints: number[]): boolean {
  const inset = input.wall + input.clearance + SCREW_EDGE_MARGIN;
  const yLow = (input.plateFront ?? input.wall + input.clearance) + SCREW_EDGE_MARGIN;
  const yHigh = (input.plateRear ?? input.depth - input.wall - input.clearance) - SCREW_EDGE_MARGIN;
  if (x < inset || x > input.width - inset || y < yLow || y > yHigh) return false;
  if (joints.some((joint) => Math.abs(x - joint) < SCREW_EDGE_MARGIN)) return false;
  if (input.cornerRadius <= 0) return true;
  // Rounded corners take a bite out of the plate.
  const radius = Math.max(input.cornerRadius - input.wall, 0.5) - input.clearance - SCREW_EDGE_MARGIN;
  const dx = Math.max(input.cornerRadius - x, x - (input.width - input.cornerRadius), 0);
  const dy = Math.max(input.cornerRadius - y, y - (input.depth - input.cornerRadius), 0);
  return !(dx > 0 && dy > 0 && Math.hypot(dx, dy) > Math.max(radius, 0));
}

// A boss stops just past its insert under a separate top panel, which it can't reach, and
// on a front or rear wall of a shell that prints on its side. Others rise to the top.
export function isShortBoss(input: Pick<PlatePlanInput, "wall" | "depth" | "plateFront" | "plateRear" | "slopeFront" | "slopeRear">, obstacles: Pick<BossObstacles, "onSide" | "capped">, x: number, y: number): boolean {
  if (obstacles.capped.some(([low, high]) => y - BOSS_RADIUS >= low && y + BOSS_RADIUS <= high)) return true;
  return obstacles.onSide && bossSlope(input, x, y) !== null;
}

// On a shell that prints upright, a boss's underside would start in mid-air over the plate, so it
// rises at 45 degrees from each wall it touches, and the plate has a wedge to fill the space under
// it. This is the line on the plate's top where each slope starts, along x or y, and which way
// is into the shell.
export interface BossFoot {
  axis: "x" | "y";
  at: number;
  inward: 1 | -1;
}

export function bossFeet(input: PlatePlanInput, x: number, y: number): BossFoot[] {
  const r = BOSS_RADIUS;
  const front = input.plateFront === undefined ? input.wall : input.plateFront - input.clearance;
  const rear = input.plateRear === undefined ? input.depth - input.wall : input.plateRear + input.clearance;
  const feet: BossFoot[] = [];
  if (x - r <= input.wall) feet.push({ axis: "x", at: input.wall, inward: 1 });
  if (x + r >= input.width - input.wall) feet.push({ axis: "x", at: input.width - input.wall, inward: -1 });
  if (y - r <= (input.plateFront ?? input.wall)) feet.push({ axis: "y", at: front, inward: 1 });
  if (y + r >= (input.plateRear ?? input.depth - input.wall)) feet.push({ axis: "y", at: rear, inward: -1 });
  return feet;
}

// How far up an upright boss's insert hole starts, so that all of it is in the boss, above its slope.
// It's 0 for a boss with a flat underside: on a shell printing on its side, away from the walls, or
// where there isn't the height for its insert that high, when its underside needs a little support.
export function bossLift(input: PlatePlanInput, profile: Profile, onSide: boolean, x: number, y: number): number {
  if (onSide) return 0;
  const feet = bossFeet(input, x, y);
  if (feet.length === 0) return 0;
  const under = Math.min(...feet.map((foot) => foot.inward * ((foot.axis === "x" ? x : y) - foot.at)));
  const lift = Math.max(under, 0) + INSERT_HOLE_DIAMETER / 2;
  const ceiling = lowestHeight(profile.inner, y - BOSS_RADIUS, y + BOSS_RADIUS);
  return ceiling - input.floorThickness < INSERT_HOLE_DEPTH + INSERT_ROOF + lift ? 0 : lift;
}

// Where a short boss stops, with its insert lifted this far.
export function shortBossTop(input: Pick<PlatePlanInput, "floorThickness">, lift: number): number {
  return input.floorThickness + SHORT_BOSS_HEIGHT + lift;
}

// How far a boss here has its insert lifted: as bossLift says, unless lifting it would put it in the
// way of something, when it keeps a flat underside, which needs a little support.
export function chosenBossLift(input: PlatePlanInput, profile: Profile, obstacles: BossObstacles, x: number, y: number): number {
  const lift = bossLift(input, profile, obstacles.onSide, x, y);
  return lift > 0 && bossProblemWith(input, profile, obstacles, x, y, lift) !== null ? 0 : lift;
}

function touchesWall(input: PlatePlanInput, x: number, y: number): boolean {
  const r = BOSS_RADIUS;
  return x - r <= input.wall || x + r >= input.width - input.wall || y - r <= (input.plateFront ?? input.wall) || y + r >= (input.plateRear ?? input.depth - input.wall);
}

// Why a boss can't go here, or null if it can. Anything in its column is in the way.
export function bossProblem(input: PlatePlanInput, profile: Profile, obstacles: BossObstacles, x: number, y: number): string | null {
  return bossProblemWith(input, profile, obstacles, x, y, chosenBossLift(input, profile, obstacles, x, y));
}

function bossProblemWith(input: PlatePlanInput, profile: Profile, obstacles: BossObstacles, x: number, y: number, lift: number): string | null {
  const r = BOSS_RADIUS;
  const short = isShortBoss(input, obstacles, x, y);
  // Slopes only go on the shell that prints on its side.
  const reachBetween = (low: number, high: number) => (obstacles.onSide ? bossReach(input, x, y, low, high) : r);
  const reach = reachBetween(-Infinity, Infinity);
  if (short && !touchesWall(input, x, y)) return "it would have nothing to hold it, so it has to touch a wall";
  if (!insidePlate(input, x, y, obstacles.joints)) return "it's too close to the edge of the plate";
  const notch = obstacles.plateNotch;
  if (notch && x > notch.xLow - SCREW_EDGE_MARGIN && x < notch.xHigh + SCREW_EDGE_MARGIN && y < notch.yHigh + SCREW_EDGE_MARGIN) return "it's too close to the edge of the plate";
  const ceiling = lowestHeight(profile.inner, y - r, y + r);
  if (ceiling - input.floorThickness < INSERT_HOLE_DEPTH + INSERT_ROOF + lift) return "there isn't enough height for its insert";
  // A slope is widest at the wall, so what matters is how wide it is where the tabs are.
  const top = short ? shortBossTop(input, lift) : profile.maxHeight;
  for (const rib of obstacles.ribs) {
    const beside = rib.tabs?.filter((tab) => tab.zLow < top).map((tab) => reachBetween(tab.yLow, tab.yHigh));
    const room = beside ? Math.max(r, ...beside) : reach;
    if (Math.abs(x - rib.x) < rib.half + room || Math.abs(x - rib.x) < reach) return "it's in the way of the seam rib";
  }
  for (const part of obstacles.floorParts) {
    const [hx, hy] = halfExtents(part);
    const dx = Math.abs(x - part.cx) - hx - reachBetween(part.cy - hy, part.cy + hy);
    const dy = Math.abs(y - part.cy) - hy - r;
    if (Math.max(dx, dy) < obstacles.partClearance) return "a board is in the way";
  }
  // A short boss stops well under the panel, so its cutouts don't matter.
  for (const c of short ? [] : obstacles.cutouts) {
    const dx = Math.max(c.xLow - x, x - c.xHigh) - reach;
    const dy = Math.max(c.yLow - y, y - c.yHigh) - r;
    if (Math.max(dx, dy) < obstacles.minWeb) return "it would show through a cutout";
  }
  for (const c of obstacles.posts) {
    if (short && (c.zLow ?? 0) > top) continue;
    const dx = Math.max(c.xLow - x, x - c.xHigh) - reach;
    const dy = Math.max(c.yLow - y, y - c.yHigh) - r;
    if (Math.max(dx, dy) < obstacles.minWeb) return "another part's screw needs that space";
  }
  // What an opening holds is a fit against real parts, so this can be close.
  for (const c of obstacles.keepOut) {
    const dx = Math.max(c.xLow - x, x - c.xHigh) - reach;
    const dy = Math.max(c.yLow - y, y - c.yHigh) - r;
    if (Math.max(dx, dy) < 0.2 - 1e-6) return "the opening's contents need that space";
  }
  // A boss's slope reaches back to the wall, so it can cross a path that the boss itself clears.
  const slope = obstacles.onSide && short ? bossSlope(input, x, y) : null;
  const blocks = (xLow: number, xHigh: number, yLow: number, yHigh: number) => {
    if (x + r > xLow && x - r < xHigh && y + r > yLow && y - r < yHigh) return true;
    return slope !== null && polygonsOverlap(slope, [[xLow, yLow], [xHigh, yLow], [xHigh, yHigh], [xLow, yHigh]]);
  };
  // These can overlap, or stand apart, but touching along a line isn't a solid that can be printed.
  for (const gusset of obstacles.gussets ?? []) {
    const dx = Math.max(gusset.xLow - x, x - gusset.xHigh, 0);
    const dy = Math.max(gusset.yLow - y, y - gusset.yHigh, 0);
    if (Math.abs(Math.hypot(dx, dy) - r) < GUSSET_TOUCH_MARGIN && gusset.zLow < top) return "it would only just touch a screw tab's gusset";
  }
  for (const screw of obstacles.driverColumns ?? []) {
    if (blocks(screw.x - DRIVER_RADIUS, screw.x + DRIVER_RADIUS, screw.y - DRIVER_RADIUS, screw.y + DRIVER_RADIUS)) return "it would block the screwdriver for a top screw";
  }
  for (const path of obstacles.seamPaths ?? []) {
    if (path.z - DRIVER_RADIUS < top && blocks(path.xLow, path.xHigh, path.y - DRIVER_RADIUS, path.y + DRIVER_RADIUS)) return "it would block the screwdriver for a seam bolt";
  }
  const column: Point2[] = [[y - r, input.floorThickness], [y + r, input.floorThickness], [y + r, top], [y - r, top]];
  for (const body of obstacles.bodies) {
    const ys = body.section.map(([sectionY]) => sectionY);
    const xGap = Math.max(body.xLow - x, x - body.xHigh) - reachBetween(Math.min(...ys), Math.max(...ys));
    if (xGap < obstacles.partClearance && polygonsOverlap(body.section, column)) return "the body of a part is in the way";
  }
  return null;
}

// A rib along the plate's joint, from the Desk Synth V2. The pieces bolt together through it before
// anything goes on, so the plate is one rigid piece. The left half has a boss for each bolt's
// insert, and the right takes its head in a countersink, driven from the right. A tongue low on
// the right half, in a groove in the left, keeps the plate flush. It's a wedge both ways, so
// neither side needs support standing up.
export const PLATE_RIB_HEIGHT = 11;
export const PLATE_RIB_LEFT = 3; // without its bosses
export const PLATE_RIB_RIGHT = 5;
export const PLATE_RIB_BOLT_Z = 6.5; // above the plate
export const PLATE_RIB_BOSS = INSERT_HOLE_DEPTH + 1; // how far a boss reaches left of the joint
export const PLATE_RIB_TONGUE = 1; // how far it reaches past the joint, and half its height
export const PLATE_RIB_TONGUE_Z = 1.6; // its middle, above the plate
export const PLATE_RIB_FIT = 0.15;
export const PLATE_RIB_DRIVER = 30; // room kept clear right of a bolt's head, for a short driver
const PLATE_RIB_SPACING = 45;
export const PLATE_RIB_END = 6; // from the rib's end to a bolt
const PLATE_RIB_SHELL_GAP = 1;

export interface PlateRib {
  x: number;
  yLow: number;
  yHigh: number;
  bolts: number[]; // their y
}

// Each grown by the room it needs around it.
export interface RibObstacle {
  xLow: number;
  xHigh: number;
  yLow: number;
  yHigh: number;
  top: number; // above the plate
  name: string;
  fixed: boolean; // on the plate already when the pieces are bolted together
}

// The rib's ends, inside the shell's bottom rounds, and clear of the shell's bosses and any seam rib
// that runs round its walls beside the joint.
export function plateRibSpan(
  cavity: Point2[],
  floor: number,
  x: number,
  screws: Point2[],
  notch: { xLow: number; xHigh: number; yHigh: number } | null,
  seams: { x: number; ribHalfThickness: number; ribWidth: number }[],
): [number, number] {
  const [front, rear] = cavitySpan(cavity, floor + 0.01, floor + PLATE_RIB_HEIGHT);
  let yLow = front + PLATE_RIB_SHELL_GAP;
  let yHigh = rear - PLATE_RIB_SHELL_GAP;
  for (const seam of seams) {
    if (seam.x - seam.ribHalfThickness > x + PLATE_RIB_RIGHT + 0.5 || seam.x + seam.ribHalfThickness < x - PLATE_RIB_BOSS - 0.5) continue;
    yLow = Math.max(yLow, front + seam.ribWidth + PLATE_RIB_SHELL_GAP);
    yHigh = Math.min(yHigh, rear - seam.ribWidth - PLATE_RIB_SHELL_GAP);
  }
  const middle = (yLow + yHigh) / 2;
  for (const [sx, sy] of screws) {
    if (sx + BOSS_RADIUS + 0.5 < x - PLATE_RIB_BOSS || sx - BOSS_RADIUS - 0.5 > x + PLATE_RIB_RIGHT) continue;
    if (sy < middle) yLow = Math.max(yLow, sy + BOSS_RADIUS + 0.5);
    else yHigh = Math.min(yHigh, sy - BOSS_RADIUS - 0.5);
  }
  if (notch && notch.xLow < x + PLATE_RIB_RIGHT && notch.xHigh > x - PLATE_RIB_BOSS) yLow = Math.max(yLow, notch.yHigh + 1);
  return [yLow, yHigh];
}

// Spreads the bolts along the rib, each moved to the nearest spot clear of what's around it.
export function layoutPlateRibBolts(rib: Omit<PlateRib, "bolts">, obstacles: RibObstacle[]): number[] {
  const from = rib.yLow + PLATE_RIB_END;
  const to = rib.yHigh - PLATE_RIB_END;
  if (to < from) return [];
  const count = Math.max(2, Math.ceil((to - from) / PLATE_RIB_SPACING) + 1);
  const chosen: number[] = [];
  for (let i = 0; i < count; i++) {
    const target = from + ((to - from) * i) / (count - 1);
    for (let shift = 0; shift <= PLATE_RIB_SPACING / 3; shift += 1) {
      const found = [target - shift, target + shift].find((y) => y >= from && y <= to && !chosen.some((c) => Math.abs(c - y) < 2 * BOSS_RADIUS + 2) && plateRibBoltProblem(rib.x, y, obstacles) === null);
      if (found !== undefined) {
        chosen.push(found);
        break;
      }
    }
  }
  return chosen.sort((a, b) => a - b);
}

// What's in the way of a bolt's boss, or of the driver for it.
export function plateRibBoltProblem(x: number, y: number, obstacles: RibObstacle[]): string | null {
  const r = BOSS_RADIUS;
  const z = PLATE_RIB_BOLT_Z;
  for (const o of obstacles) {
    const boss = o.xLow < x && o.xHigh > x - PLATE_RIB_BOSS && o.yLow < y + r && o.yHigh > y - r;
    if (boss) return `its boss runs into ${o.name}`;
    const driver = o.fixed && o.top > z - DRIVER_RADIUS && o.xLow < x + PLATE_RIB_RIGHT + PLATE_RIB_DRIVER && o.xHigh > x + PLATE_RIB_RIGHT && o.yLow < y + DRIVER_RADIUS && o.yHigh > y - DRIVER_RADIUS;
    if (driver) return `${o.name} blocks the driver for it`;
  }
  return null;
}

// Shallow enough to print as the plate's first layers, which need nothing under them.
export const FOOT_RECESS = 0.8;

// Why a rubber foot's recess can't go here, or null if it can. It's under the plate, so only
// what's cut from below matters: screws' countersinks, the joint and the rail's notch.
export function footProblem(input: PlatePlanInput, obstacles: Pick<BossObstacles, "joints" | "plateNotch">, countersinks: Point2[], x: number, y: number, diameter: number): string | null {
  const r = diameter / 2;
  const edges: Point2[] = [[x - r, y], [x + r, y], [x, y - r], [x, y + r]];
  if (edges.some(([px, py]) => !insidePlate(input, px, py, []))) return "it's too close to the edge of the plate";
  if (obstacles.joints.some((joint) => Math.abs(x - joint) < r + 1)) return "it's on the plate's joint";
  const notch = obstacles.plateNotch;
  if (notch && x + r > notch.xLow - 1 && x - r < notch.xHigh + 1 && y - r < notch.yHigh + 1) return "it's in the plate's notch for the rail";
  if (countersinks.some(([cx, cy]) => Math.hypot(cx - x, cy - y) < r + COUNTERSINK_DIAMETER / 2 + 1)) return "it's on a screw's countersink";
  return null;
}

export interface PlannedFoot {
  x: number;
  y: number;
  diameter: number;
}

export interface PlannedSupport {
  x: number;
  y: number;
  diameter: number;
  top: number;
}

// How high a support reaches: just under the lowest part of the top above it.
export function supportTop(profile: Profile, y: number, diameter: number): number {
  return lowestHeight(profile.inner, y - diameter / 2, y + diameter / 2) - SUPPORT_GAP;
}

// Why a support can't go here, or null if it can. It's a column from the plate to the top, so
// anything in that column is in the way. It's on the plate, which goes on last, so it never
// blocks a screwdriver. `fixings` are what else stands on the plate.
export function supportProblem(
  input: PlatePlanInput,
  profile: Profile,
  obstacles: BossObstacles,
  fixings: Shape[],
  x: number,
  y: number,
  diameter: number,
): string | null {
  const top = supportTop(profile, y, diameter);
  const column: Shape = { kind: "circle", cx: x, cy: y, r: diameter / 2 };
  const edge = edgeProblem(input, obstacles, column);
  if (edge) return edge;
  if (top - input.floorThickness < MIN_SUPPORT_HEIGHT) return "there's no room under the top for it";
  return standingProblem(input, obstacles, fixings, column, top, true);
}

export const WEIGHT_WALL = 2; // round a weight pocket
const WEIGHT_HEADROOM = 1; // between its walls and anything above

export interface PlannedWeight {
  x: number;
  y: number;
  width: number; // inside its walls
  depth: number;
  height: number; // of its walls, above the plate
}

// The pocket with its walls, as seen from above.
export function weightOutline(weight: Pick<PlannedWeight, "x" | "y" | "width" | "depth">): Shape {
  return { kind: "rect", cx: weight.x, cy: weight.y, w: weight.width + 2 * WEIGHT_WALL, h: weight.depth + 2 * WEIGHT_WALL };
}

// Why a weight pocket can't go here, or null if it can. Its walls stand on the plate, so it keeps
// clear of what else does, and stays under the top.
export function weightProblem(input: PlatePlanInput, profile: Profile, obstacles: BossObstacles, fixings: Shape[], weight: PlannedWeight): string | null {
  const outline = weightOutline(weight);
  const edge = edgeProblem(input, obstacles, outline);
  if (edge) return edge;
  const [, hy] = halfExtents(outline);
  const top = input.floorThickness + weight.height;
  if (top + WEIGHT_HEADROOM > lowestHeight(profile.inner, weight.y - hy, weight.y + hy)) return "it's too tall to fit under the top";
  return standingProblem(input, obstacles, fixings, outline, top, false);
}

// Whether something standing on the plate is off its edge, joint or the rail's notch.
function edgeProblem(input: PlatePlanInput, obstacles: BossObstacles, shape: Shape): string | null {
  const [hx, hy] = halfExtents(shape);
  const { cx: x, cy: y } = shape;
  const edges: Point2[] = shape.kind === "circle" ? [[x - hx, y], [x + hx, y], [x, y - hy], [x, y + hy]] : [[x - hx, y - hy], [x + hx, y - hy], [x - hx, y + hy], [x + hx, y + hy]];
  if (edges.some(([px, py]) => !insidePlate(input, px, py, []))) return "it's too close to the edge of the plate";
  if (obstacles.joints.some((joint) => Math.abs(x - joint) < hx + 1)) return "it's on the plate's joint";
  const notch = obstacles.plateNotch;
  if (notch && x + hx > notch.xLow - 1 && x - hx < notch.xHigh + 1 && y - hy < notch.yHigh + 1) return "it's in the plate's notch for the rail";
  return null;
}

// What's in the way of something standing on the plate up to `top`. It's on the plate, which goes
// on last, so it never blocks a screwdriver. `fixings` are what else stands on the plate. One that
// reaches the top could be seen through a cutout in it.
function standingProblem(input: PlatePlanInput, obstacles: BossObstacles, fixings: Shape[], shape: Shape, top: number, reachesTop: boolean): string | null {
  const [hx, hy] = halfExtents(shape);
  const { cx: x, cy: y } = shape;
  // Square on, as a box, which errs towards keeping further off.
  const near = (box: { xLow: number; xHigh: number; yLow: number; yHigh: number }, margin: number) =>
    Math.max(box.xLow - x - hx, x - hx - box.xHigh, box.yLow - y - hy, y - hy - box.yHigh) < margin;
  // The rib runs all the way round inside the shell, under the top too.
  if (obstacles.ribs.some((rib) => Math.abs(x - rib.x) < rib.half + hx)) return "it's in the way of the seam rib";
  // Round things are checked as round, so a support fits between buttons.
  if (obstacles.floorParts.some((part) => gap(part, shape) < obstacles.partClearance)) return "a board is in the way";
  if (fixings.some((fixing) => gap(fixing, shape) < obstacles.partClearance)) return "it's on another fixing on the plate";
  const clearOf = (round: Round | undefined, margin: number) => round !== undefined && roundGapTo(round, shape) >= margin;
  if (reachesTop && obstacles.cutouts.some((c) => !clearOf(c.round, obstacles.minWeb) && near(c, obstacles.minWeb))) return "it would show through a cutout";
  for (const c of obstacles.posts) {
    // A top screw's room takes in its tab, from the bottom of that up.
    if (!reachesTop && c.zLow !== undefined && top < c.zLow) continue;
    if (near(c, obstacles.minWeb)) return c.zLow === undefined ? "it's in the opening" : "a top screw needs that space";
  }
  if (obstacles.keepOut.some((c) => near(c, 0.2 - 1e-6))) return "the opening's contents need that space";
  const side: Point2[] = [[y - hy, input.floorThickness], [y + hy, input.floorThickness], [y + hy, top], [y - hy, top]];
  for (const body of obstacles.bodies) {
    if (clearOf(body.round, obstacles.partClearance)) continue;
    if (Math.max(body.xLow - x - hx, x - hx - body.xHigh) < obstacles.partClearance && polygonsOverlap(body.section, side)) return "the body of a part is in the way";
  }
  return null;
}

export interface PlateRow {
  wall: "front" | "rear" | "left" | "right";
  along: "x" | "y";
  fixed: number;
  from: number;
  to: number;
}

// The line along each wall that screws sit on, as close to it as the boss and the plate's
// countersink both allow.
export function plateRows(input: PlatePlanInput): PlateRow[] {
  const near = Math.max(input.wall + BOSS_RADIUS - BOSS_INTO_WALL, input.wall + input.clearance + SCREW_EDGE_MARGIN);
  const xLow = near;
  const xHigh = input.width - near;
  const yLow = input.plateFront === undefined ? near : Math.max(near, input.plateFront + SCREW_EDGE_MARGIN);
  const yHigh = input.plateRear === undefined ? input.depth - near : Math.min(input.depth - near, input.plateRear - SCREW_EDGE_MARGIN);
  return [
    { wall: "front", along: "x", fixed: yLow, from: xLow, to: xHigh },
    { wall: "rear", along: "x", fixed: yHigh, from: xLow, to: xHigh },
    { wall: "left", along: "y", fixed: xLow, from: yLow, to: yHigh },
    { wall: "right", along: "y", fixed: xHigh, from: yLow, to: yHigh },
  ];
}

// Places screws around the walls: at the corners, at either side of the plate's joint, then
// wherever a wall has too long a gap. Each is nudged along the wall to the nearest free
// spot, or dropped if there isn't one.
export function layoutPlateScrews(input: PlatePlanInput, profile: Profile, obstacles: BossObstacles, spacing: number): Point2[] {
  const walls = plateRows(input);
  const [{ from: xLow, to: xHigh, fixed: yLow }, { fixed: yHigh }] = walls as [PlateRow, PlateRow];
  const screws: Point2[] = [];

  // Screws only crowd each other on the same piece of the plate.
  const crowded = (x: number, y: number) =>
    screws.some(([sx, sy]) => {
      return samePlatePiece(obstacles.joints, sx, x) && Math.hypot(sx - x, sy - y) < MIN_SCREW_SPACING;
    });

  const place = (x: number, y: number, along: "x" | "y", reach: number): boolean => {
    // A screw already here covers this spot, such as a corner reached from its other wall.
    if (crowded(x, y)) return true;
    for (let offset = 0; offset <= reach; offset += SEARCH_STEP) {
      for (const sign of offset === 0 ? [1] : [1, -1]) {
        const px = along === "x" ? x + sign * offset : x;
        const py = along === "y" ? y + sign * offset : y;
        if (px < xLow - 0.01 || px > xHigh + 0.01 || py < yLow - 0.01 || py > yHigh + 0.01) continue;
        if (crowded(px, py)) continue;
        if (bossProblem(input, profile, obstacles, px, py) === null) {
          screws.push([px, py]);
          return true;
        }
      }
    }
    return false;
  };

  const cornerReach = spacing / 2;
  const at = (wall: PlateRow, position: number): [number, number] =>
    wall.along === "x" ? [position, wall.fixed] : [wall.fixed, position];

  for (const wall of walls) {
    for (const end of [wall.from, wall.to]) place(...at(wall, end), wall.along, cornerReach);
  }
  // The plate's cut edges have nothing else holding them down.
  for (const joint of obstacles.joints) {
    const clear = Math.max(SCREW_EDGE_MARGIN, BOSS_RADIUS) + 1;
    for (const wall of walls.slice(0, 2)) {
      for (const side of [-1, 1]) place(...at(wall, joint + side * clear), "x", cornerReach);
    }
  }
  for (const wall of walls) {
    const fill = () => {
      const positions = screws
        .filter(([x, y]) => (wall.along === "x" ? Math.abs(y - wall.fixed) < 0.01 : Math.abs(x - wall.fixed) < 0.01))
        .map(([x, y]) => (wall.along === "x" ? x : y))
        .sort((a, b) => a - b);
      const stops = [wall.from, ...positions, wall.to];
      for (let i = 0; i < stops.length - 1; i++) {
        if (stops[i + 1]! - stops[i]! > spacing && place(...at(wall, (stops[i]! + stops[i + 1]!) / 2), wall.along, spacing / 3)) return true;
      }
      return false;
    };
    while (fill());
  }
  return screws.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// Where an opening's top face lands in the world, for checking what's under it.
export function surfaceSpan(surface: Surface, vLow: number, vHigh: number): [number, number] {
  return [surfacePoint(surface, vLow, 0)[0], surfacePoint(surface, vHigh, 0)[0]];
}

