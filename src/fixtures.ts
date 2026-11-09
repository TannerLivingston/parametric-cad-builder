// What a floor part brings with it: a hole in the wall for its connector, which follows the
// board so the two can't drift apart, and a cradle on the plate to hold it at the right height.
import { rotateOffset, type Rotation } from "./geometry.js";
import type { FloorPart } from "./schema.js";

export type Wall = "left" | "right" | "front" | "rear";

export interface PlannedWallHole {
  wall: Wall;
  at: number; // y on the left and right walls, x on the front and rear
  z: number; // of its centre, from the base
  width: number;
  height: number;
  cornerRadius: number;
  path: string;
  componentId: string | null;
  vent?: true;
}

// How many of a vent's slots fit, spread to fill its width.
export function ventSlots({ at, width, slotWidth, gap }: { at: number; width: number; slotWidth: number; gap: number }): number[] {
  const count = Math.max(1, Math.floor((width + gap) / (slotWidth + gap)));
  const span = count * slotWidth + (count - 1) * gap;
  return Array.from({ length: count }, (_, i) => at - span / 2 + slotWidth / 2 + i * (slotWidth + gap));
}

// A bridge on the plate for a cable tie to pass under. Its slot has a pointed roof, steeper than
// 45 degrees, so it prints without support, and takes a tie up to about 4 mm wide and 1.2 mm thick.
export const TIE_BRIDGE = { across: 9.4, along: 6, height: 4.6, slotWidth: 4.4, slotSide: 1, slotHeight: 3.4 };

// What it takes up: across the tie at 0 degrees is along x.
export function tieExtent(tie: { x: number; y: number; rotationDeg: number }) {
  const hx = (tie.rotationDeg === 90 ? TIE_BRIDGE.along : TIE_BRIDGE.across) / 2;
  const hy = (tie.rotationDeg === 90 ? TIE_BRIDGE.across : TIE_BRIDGE.along) / 2;
  return { xLow: tie.x - hx, xHigh: tie.x + hx, yLow: tie.y - hy, yHigh: tie.y + hy };
}

export interface HolderBlock {
  componentId: string;
  kind: "pad" | "stop" | "clip" | "standoff";
  xLow: number;
  xHigh: number;
  yLow: number;
  yHigh: number;
  top: number; // above the top of the floor
  inward: readonly [number, number] | null; // the way a clip's barb points
  post?: { x: number; y: number; diameter: number; holeDiameter: number }; // a standoff, rather than a block
}

// From the real Desk Synth's RP2040-Plus cradle.
export const CLIP_THICKNESS = 1.6;
export const CLIP_GAP = 0.2; // between the board's edge and a clip
export const STANDOFF_HOLE_FLOOR = 0.2; // plastic left under a standoff's screw hole, so it doesn't open through the plate
export const BARB_REACH = 1;
export const BARB_HEIGHT = 1;
export const BARB_ROOM = 0.15; // between the board and its barb, so it can snap in, but not rattle
const STOP_ABOVE_BOARD = 1;

const DIRECTIONS: Record<Wall, readonly [number, number]> = { left: [-1, 0], right: [1, 0], front: [0, -1], rear: [0, 1] };

function wallFacing([dx, dy]: readonly [number, number]): Wall {
  if (dx < 0) return "left";
  if (dx > 0) return "right";
  return dy < 0 ? "front" : "rear";
}

// The wall a port faces once its board is rotated, and where its hole goes on that wall.
export function portTarget(part: FloorPart, cx: number, cy: number, rotation: Rotation) {
  const port = part.port!;
  const along = port.side === "left" || port.side === "right" ? ([0, port.at] as const) : ([port.at, 0] as const);
  const [ox, oy] = rotateOffset(along, rotation);
  const wall = wallFacing(rotateOffset(DIRECTIONS[port.side], rotation));
  return { wall, at: wall === "left" || wall === "right" ? cy + oy : cx + ox };
}

// `clipGap` is between the board's edge and a clip.
export function holderBlocks(componentId: string, part: FloorPart, cx: number, cy: number, rotation: Rotation, clipGap: number): HolderBlock[] {
  const standoffs = (part.standoffs ?? []).map((standoff): HolderBlock => {
    const [dx, dy] = rotateOffset(standoff.at, rotation);
    const [x, y] = [cx + dx, cy + dy];
    const r = standoff.diameter / 2;
    return { componentId, kind: "standoff", xLow: x - r, xHigh: x + r, yLow: y - r, yHigh: y + r, top: standoff.height, inward: null, post: { x, y, diameter: standoff.diameter, holeDiameter: standoff.holeDiameter } };
  });
  const holder = part.holder;
  if (!holder || part.footprint.shape !== "rect") return standoffs;
  const boardTop = holder.underside + holder.thickness;
  const block = (kind: HolderBlock["kind"], at: readonly [number, number], width: number, height: number, top: number, inward: HolderBlock["inward"]): HolderBlock => {
    const [dx, dy] = rotateOffset(at, rotation);
    const quarterTurned = rotation === 90 || rotation === 270;
    const hw = (quarterTurned ? height : width) / 2;
    const hh = (quarterTurned ? width : height) / 2;
    return { componentId, kind, xLow: cx + dx - hw, xHigh: cx + dx + hw, yLow: cy + dy - hh, yHigh: cy + dy + hh, top, inward: inward && rotateOffset(inward, rotation) };
  };
  const edge = part.footprint.height / 2 + clipGap + CLIP_THICKNESS / 2;
  return [
    ...standoffs,
    ...holder.pads.map((pad) => block("pad", pad.at, pad.width, pad.height, holder.underside, null)),
    ...holder.stops.map((stop) => block("stop", stop.at, stop.width, stop.height, boardTop + STOP_ABOVE_BOARD, null)),
    ...holder.clips.flatMap((clip) => [
      block("clip", [clip.at, -edge], clip.length, CLIP_THICKNESS, boardTop + BARB_ROOM + BARB_HEIGHT, [0, 1]),
      block("clip", [clip.at, edge], clip.length, CLIP_THICKNESS, boardTop + BARB_ROOM + BARB_HEIGHT, [0, -1]),
    ]),
  ];
}
