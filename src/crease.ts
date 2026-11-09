// Where two top pieces meet at a crease, as on the Desk Synth V2: a flange hangs under the rear edge of
// the front piece, and screws go through it from the front into inserts in bosses under the piece
// behind. Without it, the two only meet edge to edge, and a gap opens between them.
import type { Point2, Surface } from "./profile.js";

export const CREASE_FLANGE_THICKNESS = 3.5;
export const CREASE_FLANGE_DEPTH = 10; // below the front piece's underside
export const CREASE_SCREW_DROP = 6; // from the front piece's underside down to the screws
export const CREASE_BOSS_LENGTH = 7; // behind the flange, for a 6 mm insert
export const CREASE_BOSS_DIAMETER = 8;
export const CREASE_SPACING = 30;
export const CREASE_END = 6; // from the end of a stretch of flange to a screw
export const CREASE_DRIVER = 40; // kept clear in front of a screw's head, for a short driver

export interface CreaseJoint {
  front: number; // which top piece, the one with the flange
  rear: number; // and the one with the bosses
  y: number; // where the flange's rear face meets the bosses
  z: number; // the screws' height
  flangeTop: number;
  flangeBottom: number;
  bossTop: number; // high enough to join the rear piece's underside
  spans: [number, number][]; // where along x there's flange
  screws: number[]; // their x
}

// The height of a surface's underside at a world y.
export function undersideAt(surface: Surface, y: number, thickness = surface.thickness): number {
  const v = (y - surface.y0 - thickness * surface.sin) / surface.cos;
  return surface.z0 + v * surface.sin - thickness * surface.cos;
}

// Where the undersides of two neighbouring surfaces meet.
function undersidesMeet(front: Surface, rear: Surface): Point2 {
  const slope = (s: Surface) => s.sin / s.cos;
  const at = undersideAt;
  const y = rear.y0 + (at(front, rear.y0) - at(rear, rear.y0)) / (slope(rear) - slope(front));
  return [y, at(front, y)];
}

// Where the flange and bosses go, from the two surfaces alone.
export function creaseGeometry(front: Surface, rear: Surface) {
  const meet = Math.abs(front.sin / front.cos - rear.sin / rear.cos) < 1e-9 ? front.y1 : undersidesMeet(front, rear)[0];
  // Where the undersides meet, as on the V2, so that the bosses start right under the rear piece's
  // edge. Any further forward and each would hang a ledge under the front piece, facing down as the
  // rear piece prints face down. The flange and bosses are each trimmed to their own piece.
  const y = meet;
  const frontAt = (at: number) => undersideAt(front, at);
  const rearAt = (at: number) => undersideAt(rear, at);
  const top = frontAt(y);
  const z = top - CREASE_SCREW_DROP;
  return {
    y,
    z,
    flangeTop: Math.max(frontAt(y), frontAt(y - CREASE_FLANGE_THICKNESS)) + 0.5,
    flangeBottom: Math.min(frontAt(y), frontAt(y - CREASE_FLANGE_THICKNESS)) - CREASE_FLANGE_DEPTH,
    bossTop: Math.max(rearAt(y), rearAt(y + CREASE_BOSS_LENGTH), z + CREASE_BOSS_DIAMETER / 2) + 0.5,
  };
}

// Takes the stretches that something is in the way of out of a range.
export function clearSpans(from: number, to: number, blocked: [number, number][], shortest: number): [number, number][] {
  let spans: [number, number][] = from < to ? [[from, to]] : [];
  for (const [low, high] of blocked) {
    spans = spans.flatMap(([a, b]): [number, number][] => {
      if (high <= a || low >= b) return [[a, b]];
      return [...(low > a ? [[a, low] as [number, number]] : []), ...(high < b ? [[high, b] as [number, number]] : [])];
    });
  }
  return spans.filter(([a, b]) => b - a >= shortest);
}

// Screws spread along each stretch, at most CREASE_SPACING apart. One that's blocked moves to the
// nearest clear spot, or is left out.
export function layoutCreaseScrews(spans: [number, number][], blocked: (x: number) => boolean): number[] {
  const screws: number[] = [];
  for (const [a, b] of spans) {
    const from = a + CREASE_END;
    const to = b - CREASE_END;
    const count = Math.ceil((to - from) / CREASE_SPACING) + 1;
    const targets = to <= from ? [(a + b) / 2] : Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
    for (const target of targets) {
      for (let shift = 0; shift <= CREASE_SPACING / 3; shift += 1) {
        // A third of the spacing each way, so two never meet.
        const found = [target - shift, target + shift].find((x) => x >= Math.min(from, target) && x <= Math.max(to, target) && !blocked(x));
        if (found !== undefined) {
          screws.push(found);
          break;
        }
      }
    }
  }
  return screws.sort((p, q) => p - q);
}
