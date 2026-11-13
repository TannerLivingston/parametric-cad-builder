// Keys on the rear wall at a seam, as the real Desk Synth has in place of a bolted rib there.
//
// Seen from above, at the seam: the right half has a block on the inside of the rear wall, with a
// heat-set insert facing forward. The left half has a block of its own, and a flat tab reaching
// across the seam in front of the right half's block, which a screw goes through from the front,
// into the insert. Each block's far end slopes back to the wall at 45 degrees, so it prints without
// support with the seam up, and the tab only rises straight up from the left half's end.
//
//            rear wall
//   ─────────────┬───────────────
//    left block  │  right block      ← face: the right block's front
//   ┌────────────┼──────┐ ◦ insert
//   │      tab   │      │            ← KEY_GAP between the tab and the block
//   └────────────┼──────┘
//               seam      ↑ screw from the front
import { chainHeight, type Point2, type Profile } from "./profile.js";

export const KEY_THICKNESS = 4; // the tab, front to back
export const KEY_HEIGHT = 13;
export const KEY_GAP = 0.2; // between the tab and the right half's block, and round the tab's other sides
export const KEY_SCREW = 5; // from the seam to the screw
export const KEY_TAB_END = KEY_SCREW + 5; // from the seam to the tab's end
export const KEY_BLOCK_END = KEY_SCREW + 3; // from the seam to the end of the right block's face
export const KEY_LEFT_BLOCK = 3; // from the seam to the end of the left block's face
export const KEY_MIN_BLOCK = 2; // the least the right block stands off the wall
export const KEY_SPACING = 4; // between two keys
const KEY_MARGIN = 0.5; // from a key to the floor or the top
const SAMPLE = 0.25;

export interface SeamKey {
  z: number; // the middle of the key, and its screw's height
  face: number; // the y of the right block's front; the tab is in front of it
  deepest: number; // the furthest back the wall is behind the key
}

// The furthest back the space inside reaches at a height, or null if it doesn't reach that high.
export function rearInside(cavity: Point2[], z: number): number | null {
  const ys: number[] = [];
  cavity.forEach(([y0, z0], k) => {
    const [y1, z1] = cavity[(k + 1) % cavity.length]!;
    if ((z0 - z) * (z1 - z) <= 0 && z0 !== z1) ys.push(y0 + ((z - z0) * (y1 - y0)) / (z1 - z0));
  });
  return ys.length < 2 ? null : Math.max(...ys);
}

// How far each key reaches either side of the seam, at the wall, where its blocks are widest.
export function keyReach(key: SeamKey): number {
  return Math.max(KEY_BLOCK_END, KEY_LEFT_BLOCK + KEY_THICKNESS + KEY_GAP) + (key.deepest - key.face);
}

// A key with its middle at z, if it fits there: the wall behind it has to be inside the room kept
// round the seam, and the space in front of it clear of the top and the floor.
function keyAt(profile: Profile, z: number, base: number, insertDepth: number, reach: number): SeamKey | null {
  const z0 = z - KEY_HEIGHT / 2;
  const z1 = z + KEY_HEIGHT / 2;
  if (z0 < base + KEY_MARGIN) return null;
  let nearest = Infinity;
  let deepest = -Infinity;
  for (let h = z0; h <= z1 + 1e-9; h += SAMPLE) {
    const y = rearInside(profile.cavity, h);
    if (y === null) return null;
    nearest = Math.min(nearest, y);
    deepest = Math.max(deepest, y);
  }
  const atScrew = rearInside(profile.cavity, z)!;
  // The insert goes into the block, and on into the wall if the block's shallow there.
  const face = Math.min(nearest - KEY_MIN_BLOCK, atScrew - insertDepth);
  const key = { z, face, deepest };
  if (keyReach(key) > reach) return null;
  // The tab and its gap have to be inside, under the top and above any round at the bottom.
  const front = face - KEY_GAP - KEY_THICKNESS - KEY_GAP;
  for (let y = front; y <= face + 1e-9; y += SAMPLE) {
    if (chainHeight(profile.inner, y) < z1 + KEY_MARGIN) return null;
    if (profile.lower.length && chainHeight(profile.lower, y) > z0 - KEY_MARGIN) return null;
  }
  return key;
}

// Two keys if there's room for them, as far apart as they'll go, or else one where the wall behind
// it is flattest. None if not even one fits.
export function planKeys(profile: Profile, base: number, insertDepth: number, reach: number): SeamKey[] {
  const fits: SeamKey[] = [];
  for (let z = base; z <= profile.maxHeight; z += SAMPLE) {
    const key = keyAt(profile, z, base, insertDepth, reach);
    if (key) fits.push(key);
  }
  if (!fits.length) return [];
  const low = fits[0]!;
  const high = fits.at(-1)!;
  if (high.z - low.z >= KEY_HEIGHT + KEY_SPACING) return [low, high];
  return [fits.reduce((best, key) => (key.deepest - key.face < best.deepest - best.face ? key : best))];
}
