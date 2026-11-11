// The promise the validator makes, tried on layouts made at random: whatever it accepts, the
// engine builds correctly. In a file of its own, so that it has an engine to itself.
import { beforeAll, describe, expect, it } from "vitest";
import { buildEnclosure, initEngine, validateConfig, type BuildPlan, type Enclosure } from "../src/index.js";
import { buildProblems } from "./buildChecks.js";
import { blank } from "./helpers.js";

beforeAll(async () => {
  await initEngine();
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
export function randomLayout(seed: number): BuildPlan | null {
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
      let enclosure: Enclosure | undefined;
      try {
        enclosure = buildEnclosure(buildPlan);
        const problems = await buildProblems(buildPlan, enclosure);
        if (problems.length) failures.push({ seed, problems });
      } catch (error) {
        failures.push({ seed, threw: String((error as Error)?.message ?? error) });
      }
      // Forty builds in one engine run it out of memory unless each is freed once it's checked.
      for (const shape of new Set((enclosure?.parts ?? []).flatMap((part) => [part.blank, part.cut, part.shape]))) shape.delete();
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
    // Some two and a half minutes by itself, and longer with the rest of the tests running beside it.
  }, 600_000);
});
