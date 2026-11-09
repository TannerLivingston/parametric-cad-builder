// Works out how each part should sit on the bed, and what could go wrong there. It reads the
// part's real mesh rather than trusting the design, so anything the design didn't anticipate
// still shows up. The approach is from the Desk Synth's own scripts: oh.py scored orientations by
// overhang area, and islands.py looked for regions that start in mid-air.
//
// Matrices come from a surface's cos and sin, which are made without trig functions, so that a
// config gives identical files everywhere.
import { bedsFor, describeBed } from "./bedLayout.js";
import type { Surface } from "./profile.js";
import type { BuildPlan, PrintedPart } from "./validate.js";

export type Matrix = readonly [number, number, number, number, number, number, number, number, number];

export interface Orientation {
  id: string;
  label: string;
  matrix: Matrix;
  // The design shapes the part's features for this way up.
  planned: boolean;
}

export interface PartMeshData {
  vertices: ArrayLike<number>;
  triangles: ArrayLike<number>;
}

export interface OverhangPatch {
  kind: "support" | "island" | "steep" | "bridge";
  area: number;
  // Where it is on the part as designed, to find it again.
  min: [number, number, number];
  max: [number, number, number];
}

export interface OrientationReport {
  id: string;
  label: string;
  matrix: Matrix;
  offset: [number, number, number]; // puts it on the bed, centred
  size: [number, number, number]; // as it prints
  fits: boolean;
  bedArea: number;
  steepArea: number; // past 45 degrees from upright, which prints but droops
  supportArea: number; // nearly flat roofs too wide to bridge
  bridgeArea: number;
  islands: number;
  patches: OverhangPatch[];
  score: number;
  planned: boolean;
}

export interface LayerGap {
  area: number;
  fromZ: number; // as it prints
  toZ: number;
  min: [number, number, number]; // where it is on the part as designed
  max: [number, number, number];
}

export interface PrintEstimate {
  grams: number;
  hours: number;
}

export interface PartPrintReport {
  index: number;
  name: string;
  best: OrientationReport;
  reports: OrientationReport[];
  gaps: LayerGap[];
  gapArea: number;
  needsSupport: boolean;
  fingerprint: string; // of its shape, to tell whether it has changed since it was printed
  gapHeight: number; // how high the highest gap is, since a tall support costs far more than a short one
  problems: string[]; // it can't print like this
  notes: string[]; // it can, with these in mind
  resolved: string[]; // already taken care of in the design
  estimate: PrintEstimate;
}

// As in the Desk Synth's oh.py, measured against the Centauri Carbon 2 and PETG: past 45 degrees from
// upright is an overhang, and past about 70 it's a roof. These aren't proven by a print yet.
const STEEP_NZ = -Math.SQRT1_2;
const ROOF_NZ = -0.94;
const BED_TOUCH = 0.3; // above the bed, a face counts as resting on it
const BRIDGE_SPAN = 12; // a roof narrower than this can bridge
const MIN_BED_AREA = 200; // less than this tends to come off the bed
const TALL_RATIO = 4; // this much taller than its narrowest footing wants a brim
const WELD = 1000;

const AXES: Orientation[] = [
  { id: "as-designed", label: "As designed, base down", matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], planned: false },
  { id: "upside-down", label: "Upside down", matrix: [1, 0, 0, 0, -1, 0, 0, 0, -1], planned: false },
  { id: "left-down", label: "Left wall on the bed", matrix: [0, 0, -1, 0, 1, 0, 1, 0, 0], planned: false },
  { id: "right-down", label: "Right wall on the bed", matrix: [0, 0, 1, 0, 1, 0, -1, 0, 0], planned: false },
  { id: "front-down", label: "Front wall on the bed", matrix: [1, 0, 0, 0, 0, -1, 0, 1, 0], planned: false },
  { id: "rear-down", label: "Rear wall on the bed", matrix: [1, 0, 0, 0, 0, 1, 0, -1, 0], planned: false },
];

// With this surface's outside flat on the bed.
export function faceDown(surface: Pick<Surface, "cos" | "sin">): Matrix {
  const { cos, sin } = surface;
  return [1, 0, 0, 0, -cos, -sin, 0, sin, -cos];
}

const isSame = (a: Matrix, b: Matrix) => a.every((value, i) => Math.abs(value - b[i]!) < 1e-9);

// Whether the shell prints on its side, which its features are then shaped for. Halves print best
// that way, because the open seam faces up. A shell in one piece would have its far wall as a wide
// roof, so it stays upright, unless the mesh says otherwise.
export function shellPrintsOnSide(seams: number): boolean {
  return seams > 0;
}

// The ways a part could print: every wall down, and each surface it has face down.
export function orientationsFor(plan: BuildPlan, part: PrintedPart): Orientation[] {
  const { surfaces } = plan.profile;
  const piece = part.kind === "top" ? plan.topPieces.find((p) => p.printedPart === part.index) : undefined;
  // A knob stands along its surface's normal, so its top is parallel to that surface.
  const knob = part.kind === "knob" ? plan.knobs.find((k) => k.printedPart === part.index) : undefined;
  const ownSurface = piece?.surface ?? knob?.surface;
  const own = ownSurface ? surfaces.filter((s) => s.id === ownSurface) : part.kind === "shell" ? surfaces : [];
  const faces = own.map((surface): Orientation => ({ id: `face-${surface.id}`, label: knob ? "Its top on the bed" : `The ${surface.id} surface on the bed`, matrix: faceDown(surface), planned: false }));
  const all = [...faces, ...AXES].filter((option, i, list) => list.findIndex((other) => isSame(other.matrix, option.matrix)) === i);
  const planned = plannedOrientation(plan, part, faces);
  return all.map((option) => ({ ...option, planned: planned !== null && isSame(option.matrix, planned) }));
}

function plannedOrientation(plan: BuildPlan, part: PrintedPart, faces: Orientation[]): Matrix | null {
  if (part.kind === "top" || part.kind === "knob") return faces[0]?.matrix ?? null;
  if (part.kind === "shell" && plan.shellOnSide) return AXES[part.index === 0 ? 2 : 3]!.matrix;
  return AXES[0]!.matrix;
}

interface Welded {
  points: Float64Array; // x, y, z per welded vertex
  triangles: Uint32Array;
}

export function weldMesh(mesh: PartMeshData): Welded {
  const ids = new Map<string, number>();
  const points: number[] = [];
  const count = mesh.vertices.length / 3;
  const remap = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const x = mesh.vertices[i * 3]!;
    const y = mesh.vertices[i * 3 + 1]!;
    const z = mesh.vertices[i * 3 + 2]!;
    const key = `${Math.round(x * WELD)},${Math.round(y * WELD)},${Math.round(z * WELD)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = points.length / 3;
      ids.set(key, id);
      points.push(x, y, z);
    }
    remap[i] = id;
  }
  const triangles = new Uint32Array(mesh.triangles.length);
  for (let i = 0; i < triangles.length; i++) triangles[i] = remap[mesh.triangles[i]!]!;
  return { points: Float64Array.from(points), triangles };
}

// Groups triangles that share an edge.
function groupsOf(welded: Welded, chosen: number[]): number[][] {
  const owner = new Map<string, number[]>();
  const parent = new Map<number, number>();
  const find = (t: number): number => {
    let root = t;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let at = t;
    while (parent.get(at) !== root) {
      const next = parent.get(at)!;
      parent.set(at, root);
      at = next;
    }
    return root;
  };
  for (const t of chosen) {
    parent.set(t, t);
    const a = welded.triangles[t * 3]!;
    const b = welded.triangles[t * 3 + 1]!;
    const c = welded.triangles[t * 3 + 2]!;
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const key = p < q ? `${p}_${q}` : `${q}_${p}`;
      const others = owner.get(key);
      if (others) {
        for (const other of others) parent.set(find(other), find(t));
        others.push(t);
      } else {
        owner.set(key, [t]);
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (const t of chosen) {
    const root = find(t);
    const group = groups.get(root);
    if (group) group.push(t);
    else groups.set(root, [t]);
  }
  return [...groups.values()];
}

export function analyseOrientation(welded: Welded, orientation: Pick<Orientation, "id" | "label" | "matrix" | "planned">, bed: { x: number; y: number; z: number }): OrientationReport {
  const m = orientation.matrix;
  const { points, triangles } = welded;
  const vertexCount = points.length / 3;
  const px = new Float64Array(vertexCount);
  const py = new Float64Array(vertexCount);
  const pz = new Float64Array(vertexCount);
  let [xLow, yLow, zLow, xHigh, yHigh, zHigh] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertexCount; i++) {
    const x = points[i * 3]!;
    const y = points[i * 3 + 1]!;
    const z = points[i * 3 + 2]!;
    px[i] = m[0] * x + m[1] * y + m[2] * z;
    py[i] = m[3] * x + m[4] * y + m[5] * z;
    pz[i] = m[6] * x + m[7] * y + m[8] * z;
    xLow = Math.min(xLow, px[i]!);
    xHigh = Math.max(xHigh, px[i]!);
    yLow = Math.min(yLow, py[i]!);
    yHigh = Math.max(yHigh, py[i]!);
    zLow = Math.min(zLow, pz[i]!);
    zHigh = Math.max(zHigh, pz[i]!);
  }
  const size: [number, number, number] = [xHigh - xLow, yHigh - yLow, zHigh - zLow];
  const fits = size[2] <= bed.z && ((size[0] <= bed.x && size[1] <= bed.y) || (size[0] <= bed.y && size[1] <= bed.x));
  const offset: [number, number, number] = [bed.x / 2 - (xLow + xHigh) / 2, bed.y / 2 - (yLow + yHigh) / 2, -zLow];

  let bedArea = 0;
  const steep: number[] = [];
  const roof: number[] = [];
  const areas = new Float64Array(triangles.length / 3);
  const down = new Uint8Array(vertexCount);
  for (let t = 0; t < areas.length; t++) {
    const a = triangles[t * 3]!;
    const b = triangles[t * 3 + 1]!;
    const c = triangles[t * 3 + 2]!;
    const ux = px[b]! - px[a]!;
    const uy = py[b]! - py[a]!;
    const uz = pz[b]! - pz[a]!;
    const vx = px[c]! - px[a]!;
    const vy = py[c]! - py[a]!;
    const vz = pz[c]! - pz[a]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length === 0) continue;
    const area = length / 2;
    areas[t] = area;
    const facing = nz / length;
    // Only what's all down at the bed counts as resting on it. A big triangle with one corner there
    // can still be a wide face tilting away over nothing.
    const high = Math.max(pz[a]!, pz[b]!, pz[c]!) - zLow;
    if (high < BED_TOUCH) {
      if (facing < -0.99) bedArea += area;
      continue;
    }
    if (facing < STEEP_NZ) steep.push(t);
    if (facing < ROOF_NZ) roof.push(t);
    if (facing < -0.2) down[a] = down[b] = down[c] = 1;
  }
  const areaOf = (group: number[]) => group.reduce((sum, t) => sum + areas[t]!, 0);
  const steepArea = areaOf(steep);
  const designBounds = (group: number[]) => {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const t of group) {
      for (let k = 0; k < 3; k++) {
        const v = triangles[t * 3 + k]!;
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis]!, points[v * 3 + axis]!);
          max[axis] = Math.max(max[axis]!, points[v * 3 + axis]!);
        }
      }
    }
    return { min, max };
  };
  const printedSpan = (group: number[]) => {
    let [xa, xb, ya, yb] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const t of group) {
      for (let k = 0; k < 3; k++) {
        const v = triangles[t * 3 + k]!;
        xa = Math.min(xa, px[v]!);
        xb = Math.max(xb, px[v]!);
        ya = Math.min(ya, py[v]!);
        yb = Math.max(yb, py[v]!);
      }
    }
    return Math.min(xb - xa, yb - ya);
  };
  const patches: OverhangPatch[] = [];
  let supportArea = 0;
  let bridgeArea = 0;
  for (const group of groupsOf(welded, roof)) {
    const area = areaOf(group);
    const narrow = printedSpan(group) <= BRIDGE_SPAN;
    if (narrow) bridgeArea += area;
    else supportArea += area;
    patches.push({ kind: narrow ? "bridge" : "support", area, ...designBounds(group) });
  }
  for (const group of groupsOf(welded, steep)) {
    const area = areaOf(group);
    const roofed = group.every((t) => roof.includes(t));
    if (!roofed && area > 5) patches.push({ kind: "steep", area, ...designBounds(group) });
  }

  // A region that starts in mid-air: a lowest point with nothing lower around it, on a face looking down.
  const neighbours: number[][] = Array.from({ length: vertexCount }, () => []);
  for (let t = 0; t < areas.length; t++) {
    const a = triangles[t * 3]!;
    const b = triangles[t * 3 + 1]!;
    const c = triangles[t * 3 + 2]!;
    neighbours[a]!.push(b, c);
    neighbours[b]!.push(a, c);
    neighbours[c]!.push(a, b);
  }
  const seen = new Uint8Array(vertexCount);
  let islands = 0;
  for (let i = 0; i < vertexCount; i++) {
    if (seen[i] || !down[i] || pz[i]! - zLow < BED_TOUCH) continue;
    const level = pz[i]!;
    const stack = [i];
    const members: number[] = [];
    seen[i] = 1;
    let lowest = true;
    while (stack.length) {
      const v = stack.pop()!;
      members.push(v);
      for (const n of neighbours[v]!) {
        if (pz[n]! < level - 0.005) lowest = false;
        else if (pz[n]! < level + 0.005 && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (lowest) {
      islands += 1;
      const min: [number, number, number] = [Infinity, Infinity, Infinity];
      const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (const v of members) {
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis]!, points[v * 3 + axis]!);
          max[axis] = Math.max(max[axis]!, points[v * 3 + axis]!);
        }
      }
      patches.push({ kind: "island", area: 0, min, max });
    }
  }
  patches.sort((a, b) => b.area - a.area);

  const score = orientationScore({ fits, supportArea, islands, steepArea, bridgeArea, height: size[2], bedArea, planned: orientation.planned });
  return { id: orientation.id, label: orientation.label, matrix: m, offset, size, fits, bedArea, steepArea, supportArea, bridgeArea, islands, patches, score, planned: orientation.planned };
}

// Lower is better. Support is what costs, then islands, which can fail a print outright. Droop and
// height decide the rest.
export function orientationScore(o: { fits: boolean; supportArea: number; islands: number; steepArea: number; bridgeArea: number; height: number; bedArea: number; planned: boolean }): number {
  return (
    (o.fits ? 0 : 1e9) +
    o.supportArea * 4 +
    o.islands * 500 +
    o.steepArea * 0.5 +
    o.bridgeArea * 0.25 +
    o.height * 3 +
    (o.bedArea < MIN_BED_AREA ? 2000 : 0) -
    (o.planned ? PLANNED_BONUS : 0)
  );
}

// Features are shaped for the planned way up, which an area count can't see, so another has to beat
// it by a clear margin.
const PLANNED_BONUS = 1500;

// Goes up through the part a layer at a time, as Desk Synth's support.py did, and finds what has nothing
// under it. It's slower than reading faces, so it's for the chosen orientation only, but it sees what
// faces can't, such as a sliver left where a bore breaks through a slope.
const LAYER = 0.2;
const PIXEL = 0.4;
const REACH_PIXELS = 2; // how far a layer can stick out past the one below
const MIN_GAP = 0.5;
const MIN_GAP_HEIGHT = 1; // lower than this, the first layers take care of it

// Changes with the part's shape, and not with the order of its mesh.
export function meshFingerprint(welded: Welded): string {
  let low = 0;
  let high = 0;
  const { points, triangles } = welded;
  for (let t = 0; t < triangles.length; t += 3) {
    let each = 0;
    for (let k = 0; k < 3; k++) {
      const v = triangles[t + k]!;
      for (let axis = 0; axis < 3; axis++) each = (Math.imul(each, 31) + Math.round(points[v * 3 + axis]! * WELD)) | 0;
      // Mixed by corner, then added up, so that which triangle comes first doesn't matter.
      low = (low + Math.imul(each ^ (each >>> 13), 0x5bd1e995)) | 0;
      high = (high + Math.imul(each ^ (each >>> 7), 0x9e3779b1)) | 0;
    }
  }
  return `${(low >>> 0).toString(16)}${(high >>> 0).toString(16)}-${triangles.length / 3}`;
}

export function findLayerGaps(welded: Welded, report: Pick<OrientationReport, "matrix">): LayerGap[] {
  const m = report.matrix;
  const { points, triangles } = welded;
  const count = points.length / 3;
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  const pz = new Float64Array(count);
  let [xLow, yLow, zLow, xHigh, yHigh, zHigh] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const x = points[i * 3]!;
    const y = points[i * 3 + 1]!;
    const z = points[i * 3 + 2]!;
    px[i] = m[0] * x + m[1] * y + m[2] * z;
    py[i] = m[3] * x + m[4] * y + m[5] * z;
    pz[i] = m[6] * x + m[7] * y + m[8] * z;
    xLow = Math.min(xLow, px[i]!);
    xHigh = Math.max(xHigh, px[i]!);
    yLow = Math.min(yLow, py[i]!);
    yHigh = Math.max(yHigh, py[i]!);
    zLow = Math.min(zLow, pz[i]!);
    zHigh = Math.max(zHigh, pz[i]!);
  }
  const x0 = xLow - PIXEL;
  const y0 = yLow - PIXEL;
  const nx = Math.ceil((xHigh - x0 + PIXEL) / PIXEL) + 1;
  const ny = Math.ceil((yHigh - y0 + PIXEL) / PIXEL) + 1;
  const triangleCount = triangles.length / 3;
  const order = Array.from({ length: triangleCount }, (_, t) => t).sort((a, b) => {
    const low = (t: number) => Math.min(pz[triangles[t * 3]!]!, pz[triangles[t * 3 + 1]!]!, pz[triangles[t * 3 + 2]!]!);
    return low(a) - low(b);
  });
  const active: number[] = [];
  let next = 0;
  let previous: Uint8Array | null = null;
  const crossings: number[][] = Array.from({ length: ny }, () => []);
  const hits: LayerGap[] = [];
  const toDesign = (x: number, y: number, z: number): [number, number, number] => [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z];
  for (let z = zLow + LAYER / 2; z < zHigh; z += LAYER) {
    while (next < triangleCount) {
      const t = order[next]!;
      if (Math.min(pz[triangles[t * 3]!]!, pz[triangles[t * 3 + 1]!]!, pz[triangles[t * 3 + 2]!]!) > z) break;
      active.push(t);
      next += 1;
    }
    for (const row of crossings) row.length = 0;
    for (let a = active.length - 1; a >= 0; a--) {
      const t = active[a]!;
      const i = triangles[t * 3]!;
      const j = triangles[t * 3 + 1]!;
      const k = triangles[t * 3 + 2]!;
      if (Math.max(pz[i]!, pz[j]!, pz[k]!) < z) {
        active[a] = active[active.length - 1]!;
        active.pop();
        continue;
      }
      const cut: number[] = [];
      for (const [p, q] of [[i, j], [j, k], [k, i]] as const) {
        const dp = pz[p]! - z;
        const dq = pz[q]! - z;
        if (dp < 0 !== dq < 0) {
          const f = dp / (dp - dq);
          cut.push(px[p]! + (px[q]! - px[p]!) * f, py[p]! + (py[q]! - py[p]!) * f);
        }
      }
      if (cut.length !== 4) continue;
      const [ax, ay, bx, by] = cut as [number, number, number, number];
      const first = Math.max(0, Math.ceil((Math.min(ay, by) - y0) / PIXEL - 0.5));
      const last = Math.min(ny - 1, Math.floor((Math.max(ay, by) - y0) / PIXEL - 0.5));
      for (let row = first; row <= last; row++) {
        const yc = y0 + (row + 0.5) * PIXEL;
        if (ay < yc !== by < yc) crossings[row]!.push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
      }
    }
    const current = new Uint8Array(nx * ny);
    for (let row = 0; row < ny; row++) {
      const xs = crossings[row]!.sort((a, b) => a - b);
      for (let c = 0; c + 1 < xs.length; c += 2) {
        const from = Math.max(0, Math.ceil((xs[c]! - x0) / PIXEL - 0.5));
        const to = Math.min(nx - 1, Math.floor((xs[c + 1]! - x0) / PIXEL - 0.5));
        if (to >= from) current.fill(1, row * nx + from, row * nx + to + 1);
      }
    }
    if (previous) {
      let reach: Uint8Array = previous;
      for (let step = 0; step < REACH_PIXELS; step++) {
        const grown = reach.slice();
        for (let row = 0; row < ny; row++) {
          for (let col = 0; col < nx; col++) {
            if (!reach[row * nx + col]) continue;
            if (col > 0) grown[row * nx + col - 1] = 1;
            if (col < nx - 1) grown[row * nx + col + 1] = 1;
            if (row > 0) grown[(row - 1) * nx + col] = 1;
            if (row < ny - 1) grown[(row + 1) * nx + col] = 1;
          }
        }
        reach = grown;
      }
      // A run with what's held up at both ends, and no longer than a bridge can go, bridges, along
      // either axis, as a slicer would.
      const held = (i: number) => current[i] === 1 && reach[i] === 1;
      const bridged = new Uint8Array(nx * ny);
      const across = (count: number, length: number, at: (line: number, step: number) => number) => {
        for (let line = 0; line < count; line++) {
          let step = 0;
          while (step < length) {
            const first = at(line, step);
            if (!current[first] || reach[first]) {
              step += 1;
              continue;
            }
            let end = step;
            while (end + 1 < length && current[at(line, end + 1)] && !reach[at(line, end + 1)]) end += 1;
            if (step > 0 && end + 1 < length && held(at(line, step - 1)) && held(at(line, end + 1)) && (end - step + 1 + 2 * REACH_PIXELS) * PIXEL <= BRIDGE_SPAN) {
              for (let k = step; k <= end; k++) bridged[at(line, k)] = 1;
            }
            step = end + 1;
          }
        }
      };
      across(ny, nx, (row, col) => row * nx + col);
      across(nx, ny, (col, row) => row * nx + col);
      let pixels = 0;
      let [ca, cb, ra, rb] = [Infinity, -Infinity, Infinity, -Infinity];
      for (let row = 0; row < ny; row++) {
        for (let col = 0; col < nx; col++) {
          if (current[row * nx + col] && !reach[row * nx + col] && !bridged[row * nx + col]) {
            pixels += 1;
            ca = Math.min(ca, col);
            cb = Math.max(cb, col);
            ra = Math.min(ra, row);
            rb = Math.max(rb, row);
          }
        }
      }
      const area = pixels * PIXEL * PIXEL;
      if (area >= MIN_GAP) {
        const a = toDesign(x0 + ca * PIXEL, y0 + ra * PIXEL, z);
        const b = toDesign(x0 + cb * PIXEL, y0 + rb * PIXEL, z);
        const min: [number, number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
        const max: [number, number, number] = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
        const joined = hits.find((hit) => z - zLow - hit.toZ < LAYER * 2.5 && min[0] < hit.max[0] + 2 && max[0] > hit.min[0] - 2 && min[1] < hit.max[1] + 2 && max[1] > hit.min[1] - 2 && min[2] < hit.max[2] + 2 && max[2] > hit.min[2] - 2);
        if (joined) {
          joined.area += area;
          joined.toZ = z - zLow;
          for (let axis = 0; axis < 3; axis++) {
            joined.min[axis] = Math.min(joined.min[axis]!, min[axis]!);
            joined.max[axis] = Math.max(joined.max[axis]!, max[axis]!);
          }
        } else {
          hits.push({ area, fromZ: z - zLow, toZ: z - zLow, min, max });
        }
      }
    }
    previous = current;
  }
  return hits.sort((a, b) => b.area - a.area);
}

// Fitted to what ElegooSlicer says for 26 parts of the templates and the Dial deck, on the Centauri Carbon
// 2 profile at 0.20 mm with Rapid PETG and supports where wanted. Surface stands for walls, and volume
// for infill. A shell's thin walls and supports take about twice as long per gram as a flat part. On
// the Desk Synth's nine parts, which it wasn't fitted to, the total weight comes within about 1% and the
// total time within about 6%, with a part's weight within about 20% and its time within about 40%.
const GRAMS_PER_MM2 = 0.000971;
const GRAMS_PER_MM3 = 0.000254;
const HOURS_PER_GRAM = 0.0415;
const HOURS_PER_SHELL_GRAM = 0.0839;

export function estimatePrint(welded: Welded, isShell: boolean): PrintEstimate {
  const { points, triangles } = welded;
  let area = 0;
  let volume = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [triangles[t]! * 3, triangles[t + 1]! * 3, triangles[t + 2]! * 3];
    const [ax, ay, az] = [points[a]!, points[a + 1]!, points[a + 2]!];
    const [bx, by, bz] = [points[b]!, points[b + 1]!, points[b + 2]!];
    const [cx, cy, cz] = [points[c]!, points[c + 1]!, points[c + 2]!];
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  const grams = GRAMS_PER_MM2 * area + GRAMS_PER_MM3 * Math.abs(volume);
  return { grams, hours: (isShell ? HOURS_PER_SHELL_GRAM : HOURS_PER_GRAM) * grams };
}

export function totalEstimate(reports: Pick<PartPrintReport, "estimate">[]): PrintEstimate {
  return reports.reduce((sum, { estimate }) => ({ grams: sum.grams + estimate.grams, hours: sum.hours + estimate.hours }), { grams: 0, hours: 0 });
}

export function filamentCost(grams: number, pricePerKg: number): number {
  return (grams / 1000) * pricePerKg;
}

// Rounded for what it is, which is rough.
export function describeEstimate({ grams, hours }: PrintEstimate): string {
  const time = hours < 1 ? `${Math.max(5, Math.round((hours * 60) / 5) * 5)} min` : hours < 10 ? `${Math.round(hours * 2) / 2} h` : `${Math.round(hours)} h`;
  const weight = grams < 100 ? Math.max(1, Math.round(grams)) : Math.round(grams / 5) * 5;
  return `about ${time} and ${weight} g`;
}

export function planPartPrint(part: Pick<PrintedPart, "index" | "name"> & { kind?: PrintedPart["kind"] }, mesh: PartMeshData, options: Orientation[], bed: { x: number; y: number; z: number }, resolved: string[] = []): PartPrintReport {
  const welded = weldMesh(mesh);
  const reports = options.map((option) => analyseOrientation(welded, option, bed)).sort((a, b) => a.score - b.score);
  const best = reports[0]!;
  const gaps = findLayerGaps(welded, best).filter((gap) => gap.toZ >= MIN_GAP_HEIGHT);
  const gapArea = gaps.reduce((sum, gap) => sum + gap.area, 0);
  const gapHeight = Math.max(0, ...gaps.map((gap) => gap.toZ));
  const problems: string[] = [];
  const notes: string[] = [];
  const mm = (value: number) => `${Math.round(value)} mm`;
  if (!best.fits) problems.push(`${part.name} doesn't fit the ${bed.x} x ${bed.y} x ${bed.z} mm build volume in any orientation.`);
  if (gapArea > 0) notes.push(`About ${Math.max(1, Math.round(gapArea))} mm² has nothing under it, up to ${mm(gapHeight)} high, so turn on supports.`);
  if (best.islands > 0) notes.push(`${best.islands} ${best.islands === 1 ? "place starts" : "places start"} in mid-air.`);
  if (best.bedArea < MIN_BED_AREA) notes.push(`Only ${Math.round(best.bedArea)} mm² touches the bed, so use a brim.`);
  const footing = Math.min(best.size[0], best.size[1]);
  if (best.size[2] > footing * TALL_RATIO) notes.push(`It's tall for its footing, ${mm(best.size[2])} on ${mm(footing)}, so use a brim.`);
  const needsSupport = gapArea > 0 || best.islands > 0 || best.supportArea > 0;
  // What's been shaped in only counts if it's going the way it was shaped for.
  return { index: part.index, name: part.name, best, reports, gaps, gapArea, needsSupport, fingerprint: meshFingerprint(welded), gapHeight, problems, notes, resolved: best.planned ? resolved : [], estimate: estimatePrint(welded, part.kind === "shell") };
}

// What the design has already done about printing this part, for the way it's planned to go.
export function resolvedFor(plan: BuildPlan, part: PrintedPart): string[] {
  if (part.kind === "top") {
    const face = "Prints with its face on the bed, so the face comes out smooth and its posts need no support.";
    return plan.labels.some((label) => label.printedPart === part.index) ? [face, "Its labels are on the bed side too, so they come out crisp. Leave supports off for it, or the slicer may put some inside big letters."] : [face];
  }
  if (part.kind === "plate" || part.kind === "rail") return ["Prints flat, with its countersinks on the bed."];
  if (part.kind === "knob") return ["Prints top down, so the hole for its shaft opens upwards and needs no support."];
  if (plan.shellOnSide) return ["Prints on its side with the seam up, so its bosses and screw tabs slope back to the wall, and its holes have a point on top."];
  return plan.topScrews.length ? ["Prints upright, so its screw tabs have gussets under them."] : [];
}

export function planPrint(plan: BuildPlan, meshes: PartMeshData[]): PartPrintReport[] {
  return plan.printedParts.map((part) => planPartPrint(part, meshes[part.index]!, orientationsFor(plan, part), plan.config.fabrication.buildVolume, resolvedFor(plan, part)));
}

// A text file to go with the parts.
export function printGuide(plan: BuildPlan, reports: PartPrintReport[]): string {
  const { x, y, z } = plan.config.fabrication.buildVolume;
  const lines = [
    plan.config.name,
    "",
    `Parts are placed as they should print, on a ${x} x ${y} x ${z} mm bed. Don't turn them in the slicer.`,
    `Material: ${plan.config.fabrication.material}.`,
    "",
    "Parts",
  ];
  for (const report of reports) {
    const size = report.best.size.map((value) => Math.round(value)).join(" x ");
    lines.push(`- ${report.name}: ${report.best.label.toLowerCase()}, ${size} mm. ${report.needsSupport ? "Turn on supports." : "No supports needed."} Roughly ${describeEstimate(report.estimate).replace("about ", "")}.`);
    for (const note of [...report.problems, ...report.notes, ...report.resolved]) lines.push(`    ${note}`);
  }
  lines.push("", `All together, ${describeEstimate(totalEstimate(reports))}. That's a rough estimate from each part's shape. Your slicer has the real figure.`);
  const beds = bedsFor(plan, reports);
  if (beds.length < reports.length) {
    lines.push("", "Sharing the bed", "Parts of one colour that fit on the bed together. Turning one a quarter, flat on the bed, is fine. Each bed-N.3mf has them already placed.");
    beds.forEach((bed, i) => {
      const estimate = describeEstimate({ hours: bed.hours, grams: bed.grams });
      lines.push(`- Bed ${i + 1}, in ${bed.color}: ${describeBed(bed)}. ${estimate[0]!.toUpperCase()}${estimate.slice(1)}.`);
    });
  }
  const inlaid = plan.printedParts.filter((part) => plan.labels.some((label) => label.printedPart === part.index && label.color));
  if (inlaid.length) {
    lines.push("", "Inlaid labels", "Each bed's 3MF has these as one object with a part for its labels. Give that part the label's filament in the slicer.");
    for (const part of inlaid) {
      const colors = [...new Set(plan.labels.filter((label) => label.printedPart === part.index && label.color).map((label) => label.color!))];
      lines.push(`- ${part.name}: its labels in ${colors.join(" and ")}, on ${part.color}.`);
    }
  }
  if (plan.hardware.length) {
    lines.push("", "Hardware");
    for (const item of plan.hardware) lines.push(`- ${item.count} x ${item.name}`);
  }
  if (plan.assembly.length) {
    lines.push("", "Putting it together");
    plan.assembly.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  }
  lines.push("", "None of this has been checked on a printer yet. Print the fit test first.", "");
  return lines.join("\n");
}
