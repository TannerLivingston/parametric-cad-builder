// Top panels: separate pieces, usually in another colour, that cap the shell's walls and run
// to its outer edge, as on the real Desk Synth. Screws come up through tabs on the shell into
// heat-set inserts in posts under each piece.
import { highestFloor, lowestHeight, type Profile } from "./profile.js";
import { gap, halfExtents, polygonsOverlap, type Shape } from "./geometry.js";
import { DRIVER_DIAMETER, INSERT_HOLE_DEPTH, type SeamDriverPath } from "./plate.js";
import type { Point2 } from "./profile.js";

export const TOP_POST_DIAMETER = 8;
export const TOP_POST_LENGTH = INSERT_HOLE_DEPTH + 2;
export const TOP_TAB_THICKNESS = 3;
export const TOP_TAB_LENGTH = 12;
const POST_RADIUS = TOP_POST_DIAMETER / 2;
const DRIVER_RADIUS = DRIVER_DIAMETER / 2;
const TAB_REACH_PAST_SCREW = 3.2; // a clearance hole with 1.5 mm of plastic beyond it
const TAB_MAX_SPREAD = 8; // how far a tab's sloped base reaches sideways along its wall
const MIN_TOP_SCREW_SPACING = 20;
export const MIN_TOP_SCREWS = 2;

export type TopScrewWall = "left" | "right" | "front" | "rear";

export interface TopScrew {
  x: number;
  y: number;
  wall: TopScrewWall;
  postBottom: number; // the post's lower end, which the shell's tab sits just under
  piece: number; // index into the plan's top pieces
}

export interface TopPiece {
  printedPart: number;
  surface: string;
  xMin: number;
  xMax: number;
  name: string;
  // Where it meets the next piece along: a tongue on the left one, and a groove in the right.
  tongue: TopJoint | null; // on its right edge
  groove: TopJoint | null; // in its left edge
}

// A wedge at 45 degrees, so that neither piece needs support face down: its flat side is nearest
// the face, low enough for the first layers to take, and the groove's roof slopes like a
// teardrop. `face` is how far in from the face its flat side is, and `root` how wide it is.
export interface TopJoint {
  x: number;
  face: number;
  root: number;
  vFrom: number; // along the surface, short of either end
  vTo: number;
}

export const TONGUE_FIT = 0.15;
export const TONGUE_ROOT = 1.2;
export const MIN_TONGUE_ROOT = 0.6;
export const TONGUE_INSET = 3; // short of the panel's front and rear
export const GROOVE_DEPTH = TONGUE_ROOT + 2 * TONGUE_FIT; // past the split, at most

export interface TopObstacles {
  cutouts: { surface: string; shape: Shape }[];
  bodies: { xLow: number; xHigh: number; section: Point2[] }[];
  floorParts: Shape[];
  opening?: { xMin: number; xMax: number; yEnd: number } | null;
  blockedBoxes: { xLow: number; xHigh: number; yLow: number; yHigh: number; zTop: number }[];
  seamTabs: { xLow: number; xHigh: number; section: Point2[] }[];
  minWeb: number;
  partClearance: number;
  // A screw is driven up from below with the plate off, through the open base between any bottom
  // rounds, past anything fixed to the shell. Seam bolts go in first, sideways from inside it.
  openBase?: { yLow: number; yHigh: number };
  railBlocks?: { xLow: number; xHigh: number; yLow: number; yHigh: number }[];
  seamPaths?: SeamDriverPath[];
}

// The tab under a screw, as its extent in the world. It reaches from the wall to just past
// the post, or from the rear skin forward for the rear edge. On a shell printing on its side, a
// tab on the front or rear wall spreads along it, so that it slopes back to the wall as it prints.
export function topTabExtent(screw: Pick<TopScrew, "x" | "y" | "wall" | "postBottom">, wall: number, width: number, wallY: number, onSide = true) {
  const r = TAB_REACH_PAST_SCREW;
  const half = TOP_TAB_LENGTH / 2;
  const zHigh = screw.postBottom - 0.2;
  const zLow = zHigh - TOP_TAB_THICKNESS;
  if (screw.wall === "left") return { xLow: wall - 0.5, xHigh: screw.x + r, yLow: screw.y - half, yHigh: screw.y + half, zLow, zHigh, spread: 0 };
  if (screw.wall === "right") return { xLow: screw.x - r, xHigh: width - wall + 0.5, yLow: screw.y - half, yHigh: screw.y + half, zLow, zHigh, spread: 0 };
  const yLow = screw.wall === "front" ? wall - 0.5 : screw.y - r;
  const yHigh = screw.wall === "front" ? screw.y + r : wallY;
  return { xLow: screw.x - half, xHigh: screw.x + half, yLow, yHigh, zLow, zHigh, spread: onSide ? Math.min(yHigh - yLow, TAB_MAX_SPREAD) : 0 };
}

// On a shell printing upright, a flat tab would be a roof, so a gusset slopes back to the wall under
// it. It's how far it reaches below the tab, stopping above the plate.
export function tabGussetDepth(tab: ReturnType<typeof topTabExtent>, wallSide: TopScrewWall, floor: number): number {
  const reach = wallSide === "left" || wallSide === "right" ? tab.xHigh - tab.xLow : tab.yHigh - tab.yLow;
  return Math.min(reach, Math.max(tab.zLow - floor, 0));
}

export function postBottomAt(profile: Profile, y: number): number {
  return lowestHeight(profile.inner, y - POST_RADIUS, y + POST_RADIUS) - TOP_POST_LENGTH;
}

// Why a screw can't go here, or null if it can.
export function topScrewProblem(
  profile: Profile,
  obstacles: TopObstacles,
  surface: string,
  screw: Pick<TopScrew, "x" | "y" | "wall" | "postBottom">,
  sizes: { wall: number; width: number; depth: number; cornerRadius: number; floorThickness: number; rearWallY: number; seamXs: number[]; onSide?: boolean },
  uv: { u: number; v: number },
): string | null {
  const tab = topTabExtent(screw, sizes.wall, sizes.width, sizes.rearWallY, sizes.onSide ?? true);
  // Near a bottom round, the floor of the space inside is that round.
  const floor = Math.max(sizes.floorThickness, highestFloor(profile.lower, tab.yLow, tab.yHigh));
  if (tab.zLow < floor + 1) return "there isn't enough height for its tab";
  const post: Shape = { kind: "circle", cx: uv.u, cy: uv.v, r: POST_RADIUS };
  for (const cutout of obstacles.cutouts) {
    if (cutout.surface === surface && gap(post, cutout.shape) < obstacles.minWeb) return "it would show through a cutout";
  }
  const zTop = profile.maxHeight;
  const column: Point2[] = [[tab.yLow, tab.zLow], [tab.yHigh, tab.zLow], [tab.yHigh, zTop], [tab.yLow, zTop]];
  const xLow = Math.min(tab.xLow - tab.spread, screw.x - POST_RADIUS);
  const xHigh = Math.max(tab.xHigh + tab.spread, screw.x + POST_RADIUS);
  for (const seamX of sizes.seamXs) {
    if (xLow < seamX && xHigh > seamX) return "its tab would cross the seam";
  }
  const { wall, width, cornerRadius, depth } = sizes;
  // A post is on a separate part from the walls, so it has to stop short of them.
  if (screw.y - POST_RADIUS - 0.3 < wall || screw.y + POST_RADIUS + 0.3 > depth - wall) return "its post would hit the wall";
  // And a tab has to stay inside the outer skin, corners included.
  const outside = (x: number, y: number) => {
    if (x < 0.5 || x > width - 0.5 || y < 0.5 || y > depth - 0.5) return true;
    const dx = Math.max(cornerRadius - x, x - (width - cornerRadius), 0);
    const dy = Math.max(cornerRadius - y, y - (depth - cornerRadius), 0);
    return dx > 0 && dy > 0 && Math.hypot(dx, dy) > cornerRadius - 0.5;
  };
  const atWall = screw.wall === "front" ? tab.yLow : tab.yHigh;
  const corners: Point2[] = [[tab.xLow, tab.yLow], [tab.xLow, tab.yHigh], [tab.xHigh, tab.yLow], [tab.xHigh, tab.yHigh], [tab.xLow - tab.spread, atWall], [tab.xHigh + tab.spread, atWall]];
  if (corners.some(([x, y]) => outside(x, y))) return "its tab would stick out of the enclosure";
  // Rounded corners take a bite out of the room for a post.
  if (cornerRadius > 0) {
    const room = Math.max(cornerRadius - wall, 0.5) - POST_RADIUS - 0.3;
    const dx = Math.max(cornerRadius - screw.x, screw.x - (width - cornerRadius), 0);
    const dy = Math.max(cornerRadius - screw.y, screw.y - (depth - cornerRadius), 0);
    if (dx > 0 && dy > 0 && Math.hypot(dx, dy) > room) return "it's too close to a rounded corner";
  }
  for (const body of obstacles.bodies) {
    if (Math.max(body.xLow - xHigh, xLow - body.xHigh) < obstacles.partClearance && polygonsOverlap(body.section, column)) return "the body of a part is in the way";
  }
  for (const body of obstacles.seamTabs) {
    if (Math.max(body.xLow - xHigh, xLow - body.xHigh) < obstacles.partClearance && polygonsOverlap(body.section, column)) return "a seam tab is in the way";
  }
  for (const part of obstacles.floorParts) {
    const [hx, hy] = halfExtents(part);
    const dx = Math.max(part.cx - hx - xHigh, xLow - (part.cx + hx));
    const dy = Math.max(part.cy - hy - tab.yHigh, tab.yLow - (part.cy + hy));
    if (Math.max(dx, dy) < obstacles.partClearance) return "a board is in the way";
  }
  // The tab goes on after the opening is cut, so nothing would trim it, and its sloped base
  // reaches well past the post.
  const { opening } = obstacles;
  if (opening && tab.yLow < opening.yEnd + obstacles.partClearance && xLow < opening.xMax + obstacles.partClearance && xHigh > opening.xMin - obstacles.partClearance) {
    return "its tab would stick into the opening";
  }
  for (const box of obstacles.blockedBoxes) {
    const dx = Math.max(box.xLow - xHigh, xLow - box.xHigh);
    const dy = Math.max(box.yLow - tab.yHigh, tab.yLow - box.yHigh);
    // A gusset reaches below its tab, so it has to keep out of this room too.
    const lowest = sizes.onSide === false ? tab.zLow - tabGussetDepth(tab, screw.wall, sizes.floorThickness) : tab.zLow;
    if (Math.max(dx, dy) < obstacles.partClearance && lowest < box.zTop + obstacles.partClearance) return "what the opening holds needs that space";
  }
  if (sizes.onSide === false) {
    const below = tab.zLow - tabGussetDepth(tab, screw.wall, sizes.floorThickness);
    const gusset: Point2[] = [[tab.yLow, below], [tab.yHigh, below], [tab.yHigh, tab.zLow], [tab.yLow, tab.zLow]];
    for (const body of obstacles.bodies) {
      if (body.xLow < tab.xHigh + obstacles.partClearance && body.xHigh > tab.xLow - obstacles.partClearance && polygonsOverlap(body.section, gusset)) return "the body of a part is in the way of its gusset";
    }
  }
  return driverProblem(obstacles, screw, tab);
}

function driverProblem(obstacles: TopObstacles, screw: Pick<TopScrew, "x" | "y">, tab: ReturnType<typeof topTabExtent>): string | null {
  const d = DRIVER_RADIUS;
  const { x, y } = screw;
  const { openBase } = obstacles;
  if (openBase && (y - d < openBase.yLow || y + d > openBase.yHigh)) return "a screwdriver can't reach it from below, because a bottom round is in the way";
  const path: Point2[] = [[y - d, 0], [y + d, 0], [y + d, tab.zLow], [y - d, tab.zLow]];
  const inPath = (body: { xLow: number; xHigh: number; section: Point2[] }) => body.xLow < x + d && body.xHigh > x - d && polygonsOverlap(body.section, path);
  if (obstacles.bodies.some(inPath)) return "the body of a part would block its screwdriver";
  if (obstacles.seamTabs.some(inPath)) return "a seam tab would block its screwdriver";
  for (const block of obstacles.railBlocks ?? []) {
    if (block.xLow < x + d && block.xHigh > x - d && block.yLow < y + d && block.yHigh > y - d) return "a screw block for the rail would block its screwdriver";
  }
  for (const seam of obstacles.seamPaths ?? []) {
    if (tab.xHigh + tab.spread > seam.xLow && tab.xLow - tab.spread < seam.xHigh && tab.yLow < seam.y + d && tab.yHigh > seam.y - d && tab.zLow < seam.z + d && tab.zHigh > seam.z - d) {
      return "its tab would block the screwdriver for a seam bolt";
    }
  }
  return null;
}

// Whether a screw's tab or post is in the way of driving another, which sits higher.
export function blocksTopDriver(item: { screw: Pick<TopScrew, "x" | "y" | "postBottom">; tab: { xLow: number; xHigh: number; yLow: number; yHigh: number } }, driven: Pick<TopScrew, "x" | "y" | "postBottom">): boolean {
  if (item.screw.postBottom >= driven.postBottom - 0.01) return false;
  const { x, y } = driven;
  const { tab } = item;
  const inTab = tab.xLow < x + DRIVER_RADIUS && tab.xHigh > x - DRIVER_RADIUS && tab.yLow < y + DRIVER_RADIUS && tab.yHigh > y - DRIVER_RADIUS;
  return inTab || Math.hypot(item.screw.x - x, item.screw.y - y) < POST_RADIUS + DRIVER_RADIUS;
}

export { MIN_TOP_SCREW_SPACING };
