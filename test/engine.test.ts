// The promise the validator makes: whatever it accepts, the engine builds correctly.
import { beforeAll, describe, expect, it } from "vitest";
import { importSTEP, makeBox, makeCylinder, measureVolume, type Shape3D } from "replicad";
import { analyseBinarySTL, isValidSolid } from "../src/checks.js";
import { BOLT_DIAMETER } from "../src/engine.js";
import { PIN_SOCKET_DIAMETER } from "../src/plate.js";
import { BOSS_DIAMETER, COUNTERSINK_DEPTH, COUNTERSINK_DIAMETER, INSERT_HOLE_DEPTH, INSERT_HOLE_DIAMETER, SCREW_CLEARANCE_DIAMETER } from "../src/plate.js";
import { surfacePoint } from "../src/profile.js";
import { TOP_POST_LENGTH } from "../src/top.js";
import { buildEnclosure, cutoutVolume, initEngine, recutPart, validateConfig, type BuildPlan, type Enclosure } from "../src/index.js";
import { blank, deckAndPanel, deskSynth, wedge } from "./helpers.js";

beforeAll(async () => {
  await initEngine();
});

const stlBytes = async (shape: Shape3D, tolerance = 0.1) =>
  new Uint8Array(await shape.blobSTL({ binary: true, tolerance, angularTolerance: 0.3 }).arrayBuffer());

function overlap(a: Shape3D, b: Shape3D): number {
  try {
    return measureVolume(a.intersect(b));
  } catch (error) {
    // An empty intersection has nothing to measure. Anything else is a real failure.
    if (String(error).includes("deleted")) throw error;
    return 0;
  }
}

function plan(input: unknown): BuildPlan {
  const result = validateConfig(input);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
  return result.plan;
}

async function buildProblems(buildPlan: BuildPlan, enclosure: Enclosure = buildEnclosure(buildPlan)) {
  const problems: string[] = [];
  const thickness = buildPlan.config.enclosure.panelThickness;
  const { x, y, z } = buildPlan.config.fabrication.buildVolume;
  for (const part of enclosure.parts) {
    const label = `part ${part.index}`;
    if (!isValidSolid(part.shape)) problems.push(`${label}: invalid solid`);
    const mesh = analyseBinarySTL(await stlBytes(part.shape));
    if (!mesh.watertight) problems.push(`${label}: mesh not watertight`);
    const expected = buildPlan.cutouts.filter((c) => c.printedPart === part.index).reduce((sum, c) => sum + cutoutVolume(c, thickness), 0);
    const removed = measureVolume(part.blank) - measureVolume(part.cut);
    if (expected > 0 && Math.abs(removed - expected) / expected > 0.01) {
      problems.push(`${label}: removed ${removed.toFixed(1)} mm3, expected ${expected.toFixed(1)}`);
    }
    const [sx, sy, sz] = mesh.size;
    const fits = (sx <= x + 0.01 && sy <= y + 0.01) || (sx <= y + 0.01 && sy <= x + 0.01);
    if (!fits || sz > z + 0.01) problems.push(`${label}: doesn't fit the build volume`);
    // Everything but the two shell halves, which meet on purpose with pins, has to clear.
    for (const other of enclosure.parts.slice(0, part.index)) {
      if (other.kind === "shell" && part.kind === "shell") continue;
      const hit = overlap(other.shape, part.shape);
      if (hit > 0.01) {
        const { bounds } = other.shape.intersect(part.shape).boundingBox;
        problems.push(`${label}: collides with ${other.name} by ${hit.toFixed(2)} mm3 at ${bounds.flat().map((v: number) => v.toFixed(1))}`);
      }
    }
    const planned = buildPlan.printedParts[part.index]!.size;
    // A top edge fillet can round off the highest point, so height may come in lower.
    // So can a top panel, which takes the highest point off the shell it caps.
    const heightAllowance = part.kind === "shell" ? buildPlan.config.enclosure.topEdgeFillet + (buildPlan.topPieces.length ? planned[2] : 0) : 0;
    // A top piece's plan is how it lies flat for printing, and posts stick out below that.
    const sizeMatches = part.kind === "top"
      ? Math.abs(sx - planned[0]) <= 0.05 && sy <= planned[1] + 1 && sz <= planned[2] + TOP_POST_LENGTH + 0.05
      : Math.abs(sx - planned[0]) <= 0.05 && Math.abs(sy - planned[1]) <= 0.05 && sz <= planned[2] + 0.05 && sz >= planned[2] - heightAllowance - 0.05;
    if (!sizeMatches) problems.push(`${label}: size ${mesh.size} differs from planned ${planned} (${part.kind})`);
  }
  return problems;
}

describe("the Desk Synth example", () => {
  const built = () => {
    const buildPlan = plan(deskSynth());
    return { buildPlan, enclosure: buildEnclosure(buildPlan) };
  };

  it("builds correctly", async () => {
    const { buildPlan, enclosure } = built();
    expect(enclosure.parts.map((p) => p.name)).toEqual(["Shell 1", "Shell 2", "Deck 1", "Deck 2", "Panel 1", "Panel 2", "Plate 1", "Plate 2", "Front rail"]);
    expect(await buildProblems(buildPlan, enclosure)).toEqual([]);
  });

  it("has a seam that holds together", () => {
    const { buildPlan, enclosure } = built();
    const [left, right] = enclosure.parts;
    const seam = buildPlan.seams[0]!;

    expect(overlap(left!.shape, right!.shape)).toBeLessThan(0.001);
    const shifted = right!.shape.clone().translate([-1, 0, 0]); // translate consumes its shape
    expect(overlap(left!.shape, shifted)).toBeGreaterThan(100); // control for the line above

    // Every bolt hole has plastic all the way around it, on both sides of the seam.
    const ring = (radius: number, x: number, length: number, [y, z]: [number, number]) => {
      const outer = makeCylinder(radius + 1, length, [x, y, z], [1, 0, 0]);
      return outer.cut(makeCylinder(radius, length + 2, [x - 1, y, z], [1, 0, 0]));
    };
    const half = seam.ribHalfThickness;
    const coneEnd = seam.x - half + COUNTERSINK_DEPTH + 0.2;
    expect(seam.bolts.length).toBeGreaterThanOrEqual(2);
    for (const bolt of seam.bolts) {
      const leftRing = ring(BOLT_DIAMETER / 2, coneEnd, seam.x - coneEnd, bolt);
      const rightRing = ring(INSERT_HOLE_DIAMETER / 2, seam.x, half, bolt);
      expect(overlap(left!.shape, leftRing) / measureVolume(leftRing), `left of bolt at ${bolt}`).toBeGreaterThan(0.999);
      expect(overlap(right!.shape, rightRing) / measureVolume(rightRing), `right of bolt at ${bolt}`).toBeGreaterThan(0.999);
      // The right side is a blind insert hole, with plastic behind it.
      const [y, z] = bolt;
      const hole = makeCylinder(INSERT_HOLE_DIAMETER / 2 - 0.05, INSERT_HOLE_DEPTH - 0.02, [seam.x + 0.01, y, z], [1, 0, 0]);
      expect(overlap(right!.shape, hole), `insert hole at ${bolt}`).toBeLessThan(0.001);
      const behind = makeCylinder(1.2, 0.3, [seam.x + INSERT_HOLE_DEPTH + 0.05, y, z], [1, 0, 0]);
      expect(overlap(right!.shape, behind) / measureVolume(behind), `behind insert at ${bolt}`).toBeGreaterThan(0.999);
      // On the left, a screw head has a clear path in from the far side to the countersink.
      const path = makeCylinder(COUNTERSINK_DIAMETER / 2 - 0.05, seam.ribWidth, [seam.x - half - seam.ribWidth - 0.01, y, z], [1, 0, 0]);
      expect(overlap(left!.shape, path), `head path at ${bolt}`).toBeLessThan(0.001);
    }
    // Sockets are blind: there's solid plastic behind each one.
    for (const [y, z] of seam.pins) {
      const socketEnd = seam.x + seam.pinLength + 0.5;
      const plug = makeCylinder(PIN_SOCKET_DIAMETER / 2, seam.x + half - socketEnd - 0.1, [socketEnd + 0.05, y, z], [1, 0, 0]);
      expect(overlap(right!.shape, plug) / measureVolume(plug)).toBeGreaterThan(0.999);
    }
  });

  it("survives a STEP round trip", async () => {
    const { enclosure } = built();
    for (const part of enclosure.parts) {
      const reimported = (await importSTEP(new Blob([await part.shape.blobSTEP().arrayBuffer()]))) as Shape3D;
      expect(Math.abs(measureVolume(reimported) - measureVolume(part.shape))).toBeLessThan(1);
    }
  });

  it("gives identical STL bytes each time", async () => {
    const first = built().enclosure;
    const second = built().enclosure;
    for (const [i, part] of first.parts.entries()) {
      expect(Buffer.from(await stlBytes(part.shape, 0.05)).equals(Buffer.from(await stlBytes(second.parts[i]!.shape, 0.05)))).toBe(true);
    }
  });

  it("re-cuts one part to the same result as a full rebuild", () => {
    const { enclosure } = built();
    const moved = deskSynth();
    moved.components.find((c: any) => c.id === "button-2").u += 1;
    const movedPlan = plan(moved);
    recutPart(enclosure, movedPlan, 0);
    const recut = enclosure.parts[0]!.shape;
    const fresh = buildEnclosure(movedPlan).parts[0]!.shape;
    expect(measureVolume(recut)).toBeCloseTo(measureVolume(fresh), 3);
    expect(overlap(recut, fresh)).toBeCloseTo(measureVolume(fresh), 1);
  });
});

describe("the bottom plate", () => {
  const built = () => {
    const buildPlan = plan(deskSynth());
    const enclosure = buildEnclosure(buildPlan);
    return {
      buildPlan,
      enclosure,
      shells: enclosure.parts.filter((p) => p.kind === "shell"),
      plates: enclosure.parts.filter((p) => p.kind === "plate"),
    };
  };

  it("fits inside the shell without touching it", () => {
    const { shells, plates } = built();
    for (const shell of shells) for (const piece of plates) expect(overlap(shell.shape, piece.shape)).toBeLessThan(0.001);
    // The control: lift it into the bosses, and they collide.
    const lifted = plates[0]!.shape.clone().translate([0, 0, 1]);
    expect(overlap(shells[0]!.shape, lifted)).toBeGreaterThan(1);
  });

  it("has pieces that meet along a joint away from the shell's seam", () => {
    const { buildPlan, plates } = built();
    const { jointX } = buildPlan.plate!;
    expect(Math.abs(jointX! - buildPlan.seams[0]!.x)).toBeGreaterThan(30);
    expect(overlap(plates[0]!.shape, plates[1]!.shape)).toBeLessThan(0.001);
  });

  it("lines each countersunk hole up with an insert hole in a solid boss", () => {
    const { buildPlan, shells, plates } = built();
    const floor = buildPlan.config.enclosure.floorThickness;
    expect(buildPlan.plate!.screws.length).toBeGreaterThan(6);
    const all = (parts: { shape: Shape3D }[], tool: Shape3D) => parts.reduce((sum, p) => sum + overlap(p.shape, tool), 0);
    for (const [x, y] of buildPlan.plate!.screws) {
      const at = (r: number, z: number, h: number) => makeCylinder(r, h, [x, y, z], [0, 0, 1]);
      const label = `screw at ${x}, ${y}`;
      // In the plate: clear down the shank, with material around the countersink.
      expect(all(plates, at(SCREW_CLEARANCE_DIAMETER / 2 - 0.05, -1, floor + 2)), label).toBeLessThan(0.001);
      // In the boss: a clear insert hole, plastic all around it, and a roof over it.
      expect(all(shells, at(INSERT_HOLE_DIAMETER / 2 - 0.05, floor + 0.01, INSERT_HOLE_DEPTH - 0.02)), label).toBeLessThan(0.001);
      for (let a = 0; a < 8; a++) {
        // Past the point on a teardrop hole, which reaches 2.83 from the centre.
        const r = 3.4;
        const probe = makeCylinder(0.3, INSERT_HOLE_DEPTH - 1, [x + r * Math.cos((a * Math.PI) / 4), y + r * Math.sin((a * Math.PI) / 4), floor + 0.5], [0, 0, 1]);
        expect(all(shells, probe) / measureVolume(probe), label).toBeGreaterThan(0.999);
      }
      const roof = at(INSERT_HOLE_DIAMETER / 2, floor + INSERT_HOLE_DEPTH + 0.05, 0.9);
      expect(all(shells, roof) / measureVolume(roof), label).toBeGreaterThan(0.999);
    }
  });

  it("countersinks the plate to the measured size", () => {
    const { buildPlan, plates } = built();
    const [x, y] = buildPlan.plate!.screws[0]!;
    const piece = plates[0]!.shape;
    // Just inside the wide end, the hole is nearly the full head width.
    const atBase = makeCylinder(COUNTERSINK_DIAMETER / 2 - 0.1, 0.05, [x, y, 0], [0, 0, 1]);
    expect(overlap(piece, atBase)).toBeLessThan(0.001);
    const pastHead = makeCylinder(COUNTERSINK_DIAMETER / 2 + 0.3, 0.05, [x, y, 0], [0, 0, 1]);
    expect(overlap(piece, pastHead)).toBeGreaterThan(0);
  });

  it("leaves the bosses clear of every part's body", async () => {
    const { buildPlan } = built();
    for (const [x, y] of buildPlan.plate!.screws) {
      const clash = buildPlan.cutouts.find((c) => Math.abs(c.u - x) < 1 && Math.abs(c.v - y) < 1);
      expect(clash).toBeUndefined();
    }
  });

  it("can be turned off", async () => {
    const config = deskSynth();
    config.plate = { enabled: false };
    const buildPlan = plan(config);
    const enclosure = buildEnclosure(buildPlan);
    expect(enclosure.parts.some((p) => p.kind === "plate")).toBe(false);
    expect(await buildProblems(buildPlan, enclosure)).toEqual([]);
  });

  it("uses listed screw positions instead of choosing", async () => {
    const config = deckAndPanel();
    config.plate = { screws: [{ x: 20, y: 20 }, { x: 20, y: 170 }, { x: 80, y: 170 }, { x: 240, y: 20 }, { x: 240, y: 170 }, { x: 280, y: 100 }] };
    const buildPlan = plan(config);
    expect(buildPlan.plate!.screws).toHaveLength(6);
    expect(await buildProblems(buildPlan)).toEqual([]);
  });
});

describe("the display mount", () => {
  const built = () => {
    const buildPlan = plan(deskSynth());
    const part = buildPlan.cutouts.find((c) => c.componentId === "display")!;
    const surface = buildPlan.profile.surfaces.find((s) => s.id === "panel")!;
    const enclosure = buildEnclosure(buildPlan);
    const shape = enclosure.parts[part.printedPart]!.shape;
    // A short cylinder through the panel at (u, v), from one depth below the face to another.
    const probe = (u: number, v: number, radius: number, from: number, to: number) => {
      const [y, z] = surfacePoint(surface, v, -from);
      return makeCylinder(radius, from - to, [u, y, z], [0, -surface.sin, surface.cos]);
    };
    return { buildPlan, part, shape, probe };
  };

  it("cuts a through window and leaves the recess's skin around it", () => {
    const { part, shape, probe } = built();
    const { recess } = part;
    // Inside the window: clear all the way through.
    expect(overlap(shape, probe(part.u, part.v, 5, 4, -1))).toBeLessThan(0.001);
    // Beside the window and its bevel, inside the recess: plastic only in the outer 1.6 mm.
    const u = recess!.u + recess!.width / 2 - 1;
    const skin = probe(u, recess!.v, 0.9, 1.55, 0.05);
    const below = probe(u, recess!.v, 0.9, 2.95, 1.65);
    expect(overlap(shape, skin) / measureVolume(skin)).toBeGreaterThan(0.999);
    expect(overlap(shape, below)).toBeLessThan(0.001);
    // Past the recess: the full 3 mm.
    const beyond = probe(recess!.u + recess!.width / 2 + 2, recess!.v, 0.8, 2.95, 0.05);
    expect(overlap(shape, beyond) / measureVolume(beyond)).toBeGreaterThan(0.999);
  });

  it("has four posts ending at the PCB, with blind holes that M2 x 5 screws fit", () => {
    const { buildPlan, shape, probe } = built();
    const posts = buildPlan.posts.filter((p) => p.componentId === "display");
    expect(posts).toHaveLength(4);
    for (const post of posts) {
      const label = `post at ${post.u}, ${post.v}`;
      const collar = probe(post.u, post.v, post.diameter / 2 - 0.1, post.reach - 0.05, post.reach - post.holeDepth + 0.05)
        .cut(probe(post.u, post.v, post.holeDiameter / 2 + 0.05, post.reach + 1, post.reach - post.holeDepth - 1));
      expect(overlap(shape, collar) / measureVolume(collar), label).toBeGreaterThan(0.999);
      const hole = probe(post.u, post.v, post.holeDiameter / 2 - 0.05, post.reach + 0.5, post.reach - post.holeDepth + 0.02);
      expect(overlap(shape, hole), label).toBeLessThan(0.001);
      // The hole stops short of the face, for an M2 x 5 to cut the rest of its way.
      const cap = probe(post.u, post.v, post.holeDiameter / 2 - 0.05, post.reach - post.holeDepth - 0.05, 0.05);
      expect(overlap(shape, cap) / measureVolume(cap), label).toBeGreaterThan(0.999);
      const end = probe(post.u, post.v, post.diameter / 2 - 0.1, post.reach + 0.5, post.reach + 0.05);
      expect(overlap(shape, end), label).toBeLessThan(0.001);
    }
  });
});

describe("other enclosures", () => {
  it("builds one piece when there's no seam", async () => {
    const buildPlan = plan(blank({
      enclosure: wedge({ width: 200, depth: 180, rearHeight: 50, tiltDeg: 6 }),
      seams: [],
      components: [{ id: "a", type: "ttp223", u: 60, v: 60 }],
    }));
    const enclosure = buildEnclosure(buildPlan);
    expect(enclosure.parts.map((p) => p.name)).toEqual(["Shell", "Plate"]);
    expect(await buildProblems(buildPlan, enclosure)).toEqual([]);
  });

  it("builds a single tilted panel with a top edge fillet", async () => {
    const config = blank({ components: [{ id: "a", type: "ttp223", u: 60, v: 60 }] });
    config.enclosure.topEdgeFillet = 1.5;
    expect(await buildProblems(plan(config))).toEqual([]);
  });

  it("builds a deck, panel and falling back with parts on each", async () => {
    const buildPlan = plan(deckAndPanel({ components: [
      { id: "a", type: "arcade-24mm", surface: "deck", u: 40, v: 40 },
      { id: "b", type: "ttp223", surface: "panel", u: 60, v: 26 },
      { id: "c", type: "pot-9mm", surface: "panel", u: 220, v: 26 },
      { id: "d", type: "ttp223", surface: "back", u: 220, v: 30 },
      { id: "e", type: "rp2040-plus", x: 40, y: 150 },
    ] }));
    expect(await buildProblems(buildPlan)).toEqual([]);
  });

  it("builds square corners", async () => {
    const config = deckAndPanel({ components: [{ id: "a", type: "ttp223", surface: "deck", u: 60, v: 30 }] });
    config.enclosure.cornerRadius = 0;
    expect(await buildProblems(plan(config))).toEqual([]);
  });
});

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PANEL_TYPES = ["arcade-24mm", "ec11-dial-19mm", "encoder-board-5752", "latch-button", "pot-9mm", "ttp223", "oled-ssd1306", "oled-242-ssd1309"];
const FLOOR_TYPES = ["rp2040-plus", "ads7830", "pico-rp2350"];

// Random profiles, with parts placed wherever the validator allows. A third of the
// attempts slide right up to the limit, where a validator that's slightly too lenient
// would be caught out.
function randomLayout(seed: number): BuildPlan | null {
  const random = rng(seed);
  const between = (a: number, b: number) => a + random() * (b - a);
  const width = between(220, 420);
  const count = 1 + Math.floor(random() * 4);
  const surfaces: { id: string; y: number; z: number }[] = [];
  let y = 0;
  let z = between(36, 70);
  const frontHeight = z;
  for (let i = 0; i < count; i++) {
    y += between(40, 230 / count + 40);
    z = Math.max(32, Math.min(100, z + between(-0.5, 0.6) * between(10, 60)));
    surfaces.push({ id: `s${i}`, y, z });
  }
  const seamX = width * between(0.4, 0.6);
  const splitTop = (id: string) => ({ surface: id, splits: width > 280 ? [width * between(0.25, 0.35)] : [] });
  const topPanels = random() < 0.5 ? surfaces.filter(() => random() < 0.6).map((s) => splitTop(s.id)) : [];
  const openingX = [Math.max(seamX + 12, width * 0.62), width - 18];
  const opening = random() < 0.25
    ? {
        xMin: openingX[0],
        xMax: openingX[1],
        yEnd: between(30, Math.max(y * 0.6, 32)),
        sill: between(5, 9),
        rail: { depth: 12, screwX: [openingX[0]! - 8, openingX[1]! + 8] },
      }
    : undefined;
  const config: any = blank({
    topPanels,
    ...(opening ? { opening } : {}),
    enclosure: {
      width,
      frontHeight,
      surfaces,
      wall: between(2, 4),
      panelThickness: between(2, 4),
      cornerRadius: random() < 0.1 ? 0 : between(4, 10),
      topEdgeFillet: count === 1 && random() < 0.5 ? between(0.5, 1.5) : 0,
    },
    seams: random() < 0.85 ? [{ x: seamX, ribWidth: between(7, 10), ribHalfThickness: between(4, 6) }] : [],
    fabrication: { buildVolume: { x: 300, y: 300, z: 256 } },
  });
  if (!validateConfig(config).ok) return null;

  const accepts = (component: unknown) => validateConfig({ ...config, components: [...config.components, component] }).ok;
  // Rounds on the side profile, if they fit this shape.
  if (random() < 0.5) {
    const rounds = { frontBottom: random() < 0.6 ? between(6, 12) : 0, rearTop: random() < 0.6 ? between(6, 14) : 0, rearBottom: random() < 0.6 ? between(6, 12) : 0 };
    if (validateConfig({ ...config, enclosure: { ...config.enclosure, rounds } }).ok) config.enclosure.rounds = rounds;
  }
  // A hole in a wall of its own, and a board with its connector against a wall.
  if (random() < 0.4) {
    const wall = (["left", "right", "front", "rear"] as const)[Math.floor(random() * 4)]!;
    const hole = { wall, at: (wall === "left" || wall === "right" ? y : width) * between(0.3, 0.7), z: between(12, 20), width: between(8, 16), height: between(5, 8), cornerRadius: between(0, 2) };
    if (validateConfig({ ...config, wallHoles: [hole] }).ok) config.wallHoles = [hole];
  }
  if (random() < 0.5) {
    const wall = config.enclosure.wall;
    const rotationDeg = [0, 90, 180, 270][Math.floor(random() * 4)]!;
    const spot = between(0.3, 0.7);
    const candidate = {
      id: "board",
      type: "rp2040-plus",
      rotationDeg,
      x: rotationDeg === 0 ? wall + 25.7 : rotationDeg === 180 ? width - wall - 25.7 : width * spot,
      y: rotationDeg === 90 ? wall + 25.7 : rotationDeg === 270 ? y - wall - 25.7 : y * spot,
    };
    if (accepts(candidate)) config.components.push(candidate);
  }
  const wanted = 15 + Math.floor(random() * 15);
  for (let attempt = 0; attempt < 400 && config.components.length < wanted; attempt++) {
    const id = `c${attempt}`;
    if (random() < 0.1) {
      const type = FLOOR_TYPES[Math.floor(random() * FLOOR_TYPES.length)]!;
      const candidate = { id, type, x: between(0, width), y: between(0, y) };
      if (accepts(candidate)) config.components.push(candidate);
      continue;
    }
    const type = PANEL_TYPES[Math.floor(random() * PANEL_TYPES.length)]!;
    const rotationDeg = [0, 90, 180, 270][Math.floor(random() * 4)]!;
    const surface = surfaces[Math.floor(random() * count)]!.id;
    const onSurface = (u: number, v: number) => ({ id, type, rotationDeg, surface, u, v });
    const u = between(0, width);
    const v = between(0, 200);
    let candidate = onSurface(u, v);
    const last = config.components.filter((c: any) => c.surface === surface).at(-1);
    if (last && random() < 1 / 3 && accepts(candidate)) {
      // Slide towards the previous part until just before the validator objects.
      let low = 0;
      let high = 1;
      const at = (t: number) => onSurface(last.u + (u - last.u) * t, last.v + (v - last.v) * t);
      for (let i = 0; i < 12; i++) {
        const mid = (low + high) / 2;
        if (accepts(at(mid))) high = mid;
        else low = mid;
      }
      candidate = at(high);
    }
    if (accepts(candidate)) config.components.push(candidate);
  }
  const result = validateConfig(config);
  return result.ok ? result.plan : null;
}

describe("random layouts", () => {
  it("builds every layout the validator accepts", async () => {
    const totals = { layouts: 0, cutouts: 0, multiSurface: 0, surfaces: 0, withTop: 0, withOpening: 0, withHole: 0, withCradle: 0, withRounds: 0 };
    const failures: unknown[] = [];
    for (let seed = 1; seed <= Number(process.env.ENGINE_SEEDS ?? 40); seed++) {
      const buildPlan = randomLayout(seed);
      if (!buildPlan) continue;
      totals.layouts++;
      totals.cutouts += buildPlan.cutouts.length;
      totals.surfaces += buildPlan.profile.surfaces.length;
      if (buildPlan.profile.surfaces.length > 1) totals.multiSurface++;
      if (buildPlan.topPieces.length) totals.withTop++;
      if (buildPlan.config.opening) totals.withOpening++;
      if (buildPlan.wallHoles.length) totals.withHole++;
      if (buildPlan.holderBlocks.length) totals.withCradle++;
      if (Object.values(buildPlan.config.enclosure.rounds).some((radius) => radius > 0)) totals.withRounds++;
      try {
        const problems = await buildProblems(buildPlan);
        if (problems.length) failures.push({ seed, problems });
      } catch (error) {
        failures.push({ seed, threw: String((error as Error)?.message ?? error) });
      }
    }
    console.log(JSON.stringify(totals));
    expect(failures).toEqual([]);
    expect(totals.layouts).toBeGreaterThan(10);
    expect(totals.multiSurface).toBeGreaterThan(5);
    expect(totals.withTop).toBeGreaterThan(5);
    expect(totals.withOpening).toBeGreaterThan(3);
    expect(totals.withHole).toBeGreaterThan(5);
    expect(totals.withCradle).toBeGreaterThan(5);
    expect(totals.withRounds).toBeGreaterThan(5);
    expect(totals.cutouts / totals.layouts).toBeGreaterThan(8);
  });
});
