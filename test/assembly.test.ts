// The Desk Synth is an assembly: a beige shell, a black top in pieces, a plate, and a rail.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { makeBox, makeCylinder, measureVolume, type Shape3D } from "replicad";
import { analyseBinarySTL } from "../src/checks.js";
import { buildEnclosure, initEngine, validateConfig, type BuildPlan, type Enclosure } from "../src/index.js";
import { bossProblem, bossSlope, INSERT_HOLE_DEPTH, INSERT_HOLE_DIAMETER } from "../src/plate.js";
import { RAIL_FOOT_MARGIN } from "../src/validate.js";
import { topScrewProblem, type TopObstacles, type TopScrew } from "../src/top.js";
import { blank, deckAndPanel, errors, deskSynth } from "./helpers.js";

function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}

const overlap = (a: Shape3D, b: Shape3D) => {
  try {
    return measureVolume(a.intersect(b));
  } catch (error) {
    if (String(error).includes("deleted")) throw error;
    return 0;
  }
};

describe("planning the assembly", () => {
  const { printedParts, topPieces, config } = plan(deskSynth());

  it("splits the top the way the real build does", () => {
    expect(topPieces.map((p) => [p.name, p.xMin, p.xMax])).toEqual([
      ["Deck 1", 0, 186],
      ["Deck 2", 336.4, 351.4],
      ["Panel 1", 0, 214],
      ["Panel 2", 214, 351.4],
    ]);
  });

  it("gives each part its own colour", () => {
    const colors = Object.fromEntries(printedParts.map((p) => [p.name, p.color]));
    expect(colors["Deck 1"]).toBe("#1b1c1f");
    expect(colors["Panel 2"]).toBe("#1b1c1f");
    expect(colors["Shell 1"]).toBe(config.enclosure.color);
    expect(colors["Front rail"]).toBe(config.enclosure.color);
  });

  it("assigns parts on a top surface to the piece they sit on", () => {
    const { cutouts } = plan(deskSynth());
    const part = (id: string) => printedParts[cutouts.find((c) => c.componentId === id)!.printedPart]!.name;
    expect(part("button-1")).toBe("Deck 1");
    expect(part("encoders-left")).toBe("Panel 1");
    expect(part("encoders-right")).toBe("Panel 2");
  });

  it("plans a plate's height to include its pins", () => {
    const height = (name: string) => printedParts.find((p) => p.name === name)!.size[2];
    expect(height("Plate 1")).toBeCloseTo(13.15); // the board's clips
    expect(height("Plate 2")).toBeCloseTo(9); // the perfboard's standoffs, taller than the tray's pins
  });

  it("holds every top piece with at least two screws", () => {
    const { topScrews } = plan(deskSynth());
    topPieces.forEach((_, i) => expect(topScrews.filter((s) => s.piece === i).length).toBeGreaterThanOrEqual(2));
  });

  it("has no seam tab under a top panel, where nothing could hold it", () => {
    const { seams } = plan(deskSynth());
    const tops = new Set(config.topPanels.map((p) => p.surface));
    for (const tab of seams[0]!.tabs) expect(tops.has(tab.surface ?? "")).toBe(false);
  });

  it("drops the seam's front tab where the opening removed the wall", () => {
    const { seams } = plan(deskSynth());
    expect(seams[0]!.tabs.every((tab) => tab.start[0] > 92 || tab.surface !== null)).toBe(true);
  });
});

describe("what the validator rejects", () => {
  const withOpening = (change: (opening: any) => void) => {
    const config = deskSynth();
    change(config.opening);
    return config;
  };

  it("rejects a top panel on a surface that doesn't exist", () => {
    const config = deckAndPanel({ topPanels: [{ surface: "lid" }] });
    expect(errors(config).map((e) => e.code)).toContain("TOP_PANEL_INVALID");
  });

  it("rejects two top panels on one surface", () => {
    const config = deckAndPanel({ topPanels: [{ surface: "deck" }, { surface: "deck" }] });
    expect(errors(config).some((e) => e.code === "TOP_PANEL_INVALID" && e.message.includes("two top panels"))).toBe(true);
  });

  it("rejects a top piece too big for the bed, and says how to fix it", () => {
    const config = deskSynth();
    config.topPanels[1].splits = [];
    expect(errors(config).find((e) => e.code === "PART_TOO_LARGE")?.message).toContain("Add a split");
  });

  it("rejects a cutout crossing a top piece's joint", () => {
    const config = deskSynth();
    config.components.find((c: any) => c.id === "encoders-left").u = 200;
    expect(errors(config).map((e) => e.code)).toContain("CUTOUT_CROSSES_SEAM");
  });

  it("rejects a cutout in the opening", () => {
    const config = deskSynth();
    const button = config.components.find((c: any) => c.id === "button-4");
    button.u = 200;
    expect(errors(config).map((e) => e.code)).toContain("OPENING_INVALID");
  });

  it("proves what the opening holds has to fit under what's above it", () => {
    // Cutting the opening short leaves the panel low over the keys.
    const found = errors(withOpening((o) => (o.yEnd = 80)));
    expect(found.find((e) => e.code === "OPENING_INVALID")?.message).toContain("Extend opening.yEnd");
  });

  it("rejects an opening outside the walls", () => {
    expect(errors(withOpening((o) => (o.xMax = 400))).map((e) => e.code)).toContain("OPENING_INVALID");
  });

  it("rejects rail screws inside the opening", () => {
    expect(errors(withOpening((o) => (o.rail.screwX = [200, 344.5]))).find((e) => e.path === "opening.rail.screwX")).toBeDefined();
  });

  it("rejects a board in the space the opening's contents need", () => {
    const config = deskSynth();
    config.components.find((c: any) => c.id === "adc-b").x = 200;
    expect(errors(config).find((e) => e.code === "OPENING_INVALID")?.message).toContain('"adc-b"');
  });

  it("rejects a part's body hanging into that space", () => {
    const config = deskSynth();
    const deep = { name: "Deep", source: "measured", mount: "panel",
      cutouts: [{ kind: "circle", diameter: 8 }],
      above: { footprint: { shape: "circle", diameter: 8 }, height: 0 },
      below: { footprint: { shape: "circle", diameter: 12 }, depth: 14 } };
    config.customParts = { deep };
    config.components.push({ id: "deep", type: "deep", surface: "back", u: 260, v: 20 });
    expect(errors(config).find((e) => e.componentIds.includes("deep"))?.code).toBe("OPENING_INVALID");
  });

  it("still allows an enclosure with no top panels and no opening", () => {
    expect(validateConfig(blank()).ok).toBe(true);
    expect(plan(blank()).topPieces).toEqual([]);
  });
});

describe("where a top screw can't go", () => {
  // Without rounds, so that each rule here is the only one in play.
  const square = deskSynth();
  square.enclosure.rounds = {};
  const { profile } = plan(square);
  const none = { cutouts: [], bodies: [], floorParts: [], blockedBoxes: [], seamTabs: [], minWeb: 1.2, partClearance: 1 };
  const sizes = { wall: 3.25, width: 351.4, depth: 196.5, cornerRadius: 11.5, floorThickness: 3, rearWallY: 193.25, seamXs: [186] };
  const left: Omit<TopScrew, "piece"> = { x: 7.5, y: 40, wall: "left", postBottom: 17.3 };
  const check = (obstacles: Partial<TopObstacles> = {}, screw: Partial<Omit<TopScrew, "piece">> = {}) => {
    const placed = { ...left, ...screw };
    return topScrewProblem(profile, { ...none, ...obstacles }, "deck", placed, sizes, { u: placed.x, v: placed.y });
  };
  const inTheWay = { xLow: 0, xHigh: 20, section: [[35, 5], [45, 5], [45, 30], [35, 30]] as [number, number][] };
  const circle = { kind: "circle" as const, cx: 7.5, cy: 40, r: 5 };

  it("accepts a clear spot", () => expect(check()).toBeNull());
  it("needs height for the tab", () => expect(check({}, { postBottom: 3 })).toContain("height"));
  it("keeps the post off the rear wall", () => expect(check({}, { x: 60, y: 190 })).toContain("hit the wall"));
  it("keeps the post off the front wall", () => expect(check({}, { x: 60, y: 6 })).toContain("hit the wall"));
  it("keeps the tab inside a rounded corner", () => expect(check({}, { y: 186 })).toContain("stick out"));
  it("keeps the post inside a rounded corner", () => expect(check({}, { y: 11 })).toContain("rounded corner"));
  it("keeps the tab off the seam", () => expect(check({}, { wall: "front", x: 180, y: 7.5 })).toContain("seam"));
  describe("with an opening", () => {
    const opening = { xMin: 100, xMax: 160, yEnd: 60 };
    const front = (x: number) => check({ opening }, { wall: "front", x, y: 8 });
    // The post clears the opening in all of these, but the tab's sloped base reaches 14 mm each way.
    it("keeps the base of a tab out of it", () => expect(front(90)).toContain("opening"));
    it("keeps it out from the other side", () => expect(front(170)).toContain("opening"));
    it("allows a tab just clear of it", () => expect(front(85)).toBeNull());
    it("allows a tab behind it", () => expect(check({ opening: { ...opening, yEnd: 1 } }, { wall: "front", x: 130, y: 8 })).toBeNull());
  });
  it("keeps the post from showing through a cutout on its surface", () => {
    expect(check({ cutouts: [{ surface: "deck", shape: circle }] })).toContain("cutout");
    expect(check({ cutouts: [{ surface: "panel", shape: circle }] })).toBeNull();
  });
  it("keeps it clear of part bodies", () => expect(check({ bodies: [inTheWay] })).toContain("body of a part"));
  it("keeps it clear of seam tabs", () => expect(check({ seamTabs: [inTheWay] })).toContain("seam tab"));
  it("keeps it clear of boards", () => expect(check({ floorParts: [circle] })).toContain("board"));
});

describe("where a boss can't go, with its slopes", () => {
  const { profile, config } = plan(deskSynth());
  const input = { width: 351.4, depth: profile.depth, wall: 3.25, cornerRadius: 11.5, floorThickness: 3, clearance: 0.25 };
  const none = { ribs: [], jointX: null, onSide: true, capped: [], posts: [], plateNotch: null, floorParts: [], cutouts: [], keepOut: [], bodies: [], minWeb: 1.2, partClearance: 1 };
  const panelHole = { xLow: 110, xHigh: 130, yLow: 0, yHigh: 20 };

  it("lets a boss under a separate top panel sit beneath that panel's cutouts", () => {
    const seamless = { ...none, onSide: false };
    expect(bossProblem(input, profile, { ...seamless, cutouts: [panelHole] }, 120, 6.8)).toContain("cutout");
    expect(bossProblem(input, profile, { ...seamless, cutouts: [panelHole], capped: [[0, 76]] }, 120, 6.8)).toBeNull();
  });

  it("still keeps it off another part's screw", () => {
    const post = { xLow: 115, xHigh: 125, yLow: 0, yHigh: 15 };
    expect(bossProblem(input, profile, { ...none, onSide: false, capped: [[0, 76]], posts: [post] }, 120, 6.8)).toContain("screw");
  });

  it("needs a boss under a top panel to touch a wall, or nothing holds it", () => {
    expect(bossProblem(input, profile, { ...none, capped: [[0, 76]] }, 120, 40)).toContain("touch a wall");
    expect(bossProblem(input, profile, none, 120, 40)).toBeNull();
  });

  it("slopes a boss on the front or rear wall, and no other", () => {
    expect(bossSlope(input, 120, 6.8)).toHaveLength(4);
    expect(bossSlope(input, 120, profile.depth - 6.8)).toHaveLength(4);
    expect(bossSlope(input, 6.8, 80)).toBeNull();
    const [wallLeft, tangentLeft] = bossSlope(input, 120, 6.8)!;
    // Exactly 45 degrees, so that it prints without support.
    expect(Math.abs(wallLeft![0] - tangentLeft![0])).toBeCloseTo(Math.abs(wallLeft![1] - tangentLeft![1]));
  });

  it("counts the slopes when something is beside it", () => {
    const box = { xLow: 126, xHigh: 140, yLow: 0, yHigh: 20 };
    expect(bossProblem(input, profile, { ...none, keepOut: [box] }, 120, 6.8)).toContain("opening");
    // The same gap is fine for a boss with no slopes.
    expect(bossProblem(input, profile, { ...none, keepOut: [{ ...box, yLow: 70, yHigh: 90 }] }, 120, 80)).toBeNull();
    expect(bossProblem(input, profile, { ...none, ribs: [{ x: 132, half: 3 }] }, 120, 6.8)).toContain("rib");
  });

  it("keeps boards out of the rail's blocks and slopes", () => {
    const [left] = config.opening!.rail!.screwX;
    const moved = deskSynth();
    moved.customParts = { tiny: { name: "Tiny", source: "measured", mount: "floor", footprint: { shape: "rect", width: 5, height: 5 }, height: 3 } };
    moved.components.push({ id: "tiny", type: "tiny", x: left - 10, y: 14.6 });
    expect(errors(moved).find((e) => e.componentIds.includes("tiny"))?.code).toBe("OPENING_INVALID");
  });
});

describe("seam tabs and top panels", () => {
  const seamed = (extra: object) => {
    const config = deckAndPanel({ seams: [{ x: 120 }], ...extra });
    config.enclosure.width = 240;
    return config;
  };
  const tabSurfaces = (config: unknown) => plan(config).seams[0]!.tabs.map((tab) => tab.surface);

  it("puts no tab under a top panel, whose screws would have nothing to hold", () => {
    expect(tabSurfaces(seamed({}))).toContain("deck");
    expect(tabSurfaces(seamed({ topPanels: [{ surface: "deck" }] }))).not.toContain("deck");
  });

  it("puts no tab in an opening", () => {
    const opening = { xMin: 125, xMax: 220, yEnd: 60, sill: 7 };
    const hanging = plan(seamed({ opening })).seams[0]!.tabs.filter((tab) => tab.surface);
    expect(hanging.length).toBeGreaterThan(0);
    for (const tab of hanging) expect(Math.min(tab.start[0], tab.end[0])).toBeGreaterThanOrEqual(opening.yEnd);
  });
});

describe("the built assembly", () => {
  let buildPlan: BuildPlan;
  let enclosure: Enclosure;
  const part = (name: string) => enclosure.parts.find((p) => p.name === name)!;

  beforeAll(async () => {
    await initEngine();
    buildPlan = plan(deskSynth());
    enclosure = buildEnclosure(buildPlan);
  });

  it("has nine parts, none colliding with another", () => {
    expect(enclosure.parts).toHaveLength(9);
    for (let i = 0; i < enclosure.parts.length; i++) {
      for (let j = i + 1; j < enclosure.parts.length; j++) {
        const [a, b] = [enclosure.parts[i]!, enclosure.parts[j]!];
        expect(overlap(a.shape, b.shape), `${a.name} and ${b.name}`).toBeLessThan(0.01);
      }
    }
  });

  it("leaves the top of the shell open where the black top sits", () => {
    const shell = part("Shell 1").shape;
    const deckZone = makeBox([130, 20, 25.4], [145, 60, 28.2]);
    expect(overlap(shell, deckZone)).toBeLessThan(0.001);
    expect(overlap(part("Deck 1").shape, deckZone) / measureVolume(deckZone)).toBeGreaterThan(0.999);
  });

  it("caps the walls with the top, out to the outer edge", () => {
    const edge = makeBox([60, 0.2, 25.5], [100, 2.8, 28.2]);
    expect(overlap(part("Deck 1").shape, edge) / measureVolume(edge)).toBeGreaterThan(0.999);
    const wallBelow = makeBox([60, 0.2, 15], [100, 2.8, 25]);
    expect(overlap(part("Shell 1").shape, wallBelow) / measureVolume(wallBelow)).toBeGreaterThan(0.999);
  });

  it("clears the opening from the front edge, above the sill, in every part", () => {
    const { opening } = buildPlan.config;
    const air = makeBox([opening!.xMin + 1, -1, opening!.sill + 0.5], [opening!.xMax - 1, opening!.yEnd - 1, 70]);
    for (const p of enclosure.parts) expect(overlap(p.shape, air), p.name).toBeLessThan(0.001);
  });

  it("leaves nothing in the space the keybed needs", () => {
    const boxes = buildPlan.config.opening!.keepOut;
    for (const p of enclosure.parts) {
      if (p.kind === "plate" || p.kind === "rail") continue; // these are below it, or in front
      for (const box of boxes) {
        // Ahead of this, the front round's lip is under where the tray's own front edge stops.
        const yMin = Math.max(box.yMin + 0.01, buildPlan.config.enclosure.rounds.frontBottom + 0.01);
        if (yMin >= box.yMax) continue;
        const zone = makeBox([box.xMin, yMin, 3.5], [box.xMax, box.yMax, box.top]);
        expect(overlap(p.shape, zone), `${p.name} in y ${box.yMin} to ${box.yMax}`).toBeLessThan(0.01);
      }
    }
  });

  it("fits the rail across the opening, resting under the blocks at each end", () => {
    const rail = part("Front rail").shape;
    const { opening } = buildPlan.config;
    const middle = makeBox([200, 12.2, 0.1], [300, 13.9, opening!.sill - 0.1]);
    expect(overlap(rail, middle) / measureVolume(middle)).toBeGreaterThan(0.999);
    const [left, right] = opening!.rail!.screwX;
    for (const x of [left, right]) {
      // Back from the middle of the foot, where the front round leaves the base nearly flat.
      const y = opening!.rail!.depth - 3.5;
      const footHole = makeCylinder(1.5, 3, [x, y, -0.5], [0, 0, 1]);
      expect(overlap(rail, footHole), `rail hole at ${x}`).toBeLessThan(0.001);
      const shells = enclosure.parts.filter((p) => p.kind === "shell");
      const base = opening!.rail!.footHeight + 0.2;
      const insert = makeCylinder(INSERT_HOLE_DIAMETER / 2 - 0.05, INSERT_HOLE_DEPTH - 0.1, [x, y, base + 0.02], [0, 0, 1]);
      for (const shell of shells) expect(overlap(shell.shape, insert), `insert at ${x}`).toBeLessThan(0.001);
      const roof = makeCylinder(1.5, 0.5, [x, y, base + INSERT_HOLE_DEPTH + 0.2], [0, 0, 1]);
      expect(shells.reduce((sum, s) => sum + overlap(s.shape, roof), 0) / measureVolume(roof), `roof at ${x}`).toBeGreaterThan(0.999);
    }
  });

  it("lines each top screw up: a tab hole below an insert in a post", () => {
    const { topScrews, topPieces } = buildPlan;
    const shells = enclosure.parts.filter((p) => p.kind === "shell");
    for (const screw of topScrews) {
      const piece = part(topPieces[screw.piece]!.name).shape;
      const label = `${screw.wall} screw at ${screw.x}, ${screw.y}`;
      const hole = makeCylinder(INSERT_HOLE_DIAMETER / 2 - 0.05, INSERT_HOLE_DEPTH - 0.1, [screw.x, screw.y, screw.postBottom + 0.02], [0, 0, 1]);
      expect(overlap(piece, hole), `${label}: insert hole`).toBeLessThan(0.001);
      const wall = makeCylinder(0.3, INSERT_HOLE_DEPTH - 1, [screw.x + 3, screw.y, screw.postBottom + 0.5], [0, 0, 1]);
      expect(overlap(piece, wall) / measureVolume(wall), `${label}: post wall`).toBeGreaterThan(0.99);
      const tabZone = makeCylinder(1.5, 2.5, [screw.x, screw.y, screw.postBottom - 3], [0, 0, 1]);
      expect(shells.reduce((sum, s) => sum + overlap(s.shape, tabZone), 0), `${label}: clear hole in tab`).toBeLessThan(0.001);
      // On the side away from the seam, since a shell's holes have a point towards it.
      const away = screw.x < buildPlan.seams[0]!.x ? -2.5 : 2.5;
      const ring = makeCylinder(0.4, 2, [screw.x + away, screw.y, screw.postBottom - 2.9], [0, 0, 1]);
      expect(shells.reduce((sum, s) => sum + overlap(s.shape, ring), 0) / measureVolume(ring), `${label}: tab around it`).toBeGreaterThan(0.99);
    }
  });

  it("puts the tray's pins and countersunk holes on the plate", () => {
    const { plate } = buildPlan.config;
    const pieces = enclosure.parts.filter((p) => p.kind === "plate");
    for (const pin of plate.pins) {
      const tip = makeCylinder(pin.diameter / 2 - 0.1, pin.height - 0.2, [pin.x, pin.y, 3.1], [0, 0, 1]);
      expect(pieces.reduce((sum, p) => sum + overlap(p.shape, tip), 0) / measureVolume(tip), `pin at ${pin.x}`).toBeGreaterThan(0.999);
    }
    for (const pin of plate.pins) {
      // The narrow tip on top, and nothing wider around it.
      const tip = makeCylinder(pin.tipDiameter! / 2 - 0.05, pin.tipHeight! - 0.1, [pin.x, pin.y, 3 + pin.height + 0.05], [0, 0, 1]);
      expect(pieces.reduce((sum, p) => sum + overlap(p.shape, tip), 0) / measureVolume(tip), `pin tip at ${pin.x}`).toBeGreaterThan(0.999);
    }
    for (const { x, y } of plate.countersunkHoles) {
      const hole = makeCylinder(1.6, 4, [x, y, -0.5], [0, 0, 1]);
      expect(pieces.reduce((sum, p) => sum + overlap(p.shape, hole), 0), `hole at ${x}`).toBeLessThan(0.001);
    }
  });

  it("leaves no flat overhang on a shell, printed with its side wall on the bed", async () => {
    const up: Record<string, number> = { "Shell 1": 1, "Shell 2": -1 };
    for (const [name, sign] of Object.entries(up)) {
      const bytes = new DataView(await part(name).shape.blobSTL({ binary: true, tolerance: 0.1, angularTolerance: 0.3 }).arrayBuffer());
      const count = bytes.getUint32(80, true);
      const lowest = sign > 0 ? 0 : buildPlan.config.enclosure.width;
      let flat = 0;
      for (let i = 0; i < count; i++) {
        const at = (vertex: number, axis: number) => bytes.getFloat32(84 + 50 * i + 12 + 12 * vertex + 4 * axis, true);
        const u = [0, 1, 2].map((k) => at(1, k) - at(0, k));
        const v = [0, 1, 2].map((k) => at(2, k) - at(0, k));
        const normal = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
        const area = Math.hypot(...normal);
        if (area < 1e-9) continue;
        // The side wall's own round corners rest on the bed, so anything within 2 mm is fine.
        if (Math.abs((at(0, 0) + at(1, 0) + at(2, 0)) / 3 - lowest) < 2) continue;
        // Facing down in print, within 15 degrees of flat.
        if ((sign * normal[0]!) / area < -Math.cos((15 * Math.PI) / 180)) flat += area / 2;
      }
      expect(flat, name).toBeLessThan(2);
    }
  });

  it("gives holes through a shell a point towards the seam, and keeps a boss around them", () => {
    const { screws } = buildPlan.plate!;
    const seam = buildPlan.seams[0]!.x;
    const floor = buildPlan.config.enclosure.floorThickness;
    const shells = enclosure.parts.filter((p) => p.kind === "shell");
    for (const [x, y] of screws) {
      const up = x < seam ? 1 : -1;
      const probe = (dx: number) => makeCylinder(0.15, 4, [x + dx, y, floor + 1], [0, 0, 1]);
      const label = `boss at ${x}, ${y}`;
      expect(shells.reduce((sum, s) => sum + overlap(s.shape, probe(up * 2.45)), 0), `${label}: point`).toBeLessThan(0.001);
      expect(shells.reduce((sum, s) => sum + overlap(s.shape, probe(-up * 2.45)), 0) / measureVolume(probe(0)), `${label}: far side`).toBeGreaterThan(0.999);
    }
  });

  it("slopes the rail blocks back to the wall", () => {
    const { rail } = buildPlan.config.opening!;
    const { wall } = buildPlan.config.enclosure;
    const [left] = rail!.screwX;
    const base = buildPlan.config.enclosure.floorThickness + 2.5;
    const near = (x: number) => makeBox([x - 0.3, wall + 0.2, base], [x + 0.3, wall + 1.2, base + 2]);
    const out = (x: number) => makeBox([x - 0.3, rail!.depth - 1.2, base], [x + 0.3, rail!.depth - 0.2, base + 2]);
    const shells = enclosure.parts.filter((p) => p.kind === "shell");
    const fill = (tool: Shape3D) => shells.reduce((sum, s) => sum + overlap(s.shape, tool), 0) / measureVolume(tool);
    // A few mm past the block, the slope is near the wall and gone further from it.
    expect(fill(near(left - RAIL_FOOT_MARGIN - 3))).toBeGreaterThan(0.999);
    expect(fill(out(left - RAIL_FOOT_MARGIN - 3))).toBeLessThan(0.001);
  });

  it("notches the plate around the rail", () => {
    const rail = part("Front rail").shape;
    for (const piece of enclosure.parts.filter((p) => p.kind === "plate")) expect(overlap(rail, piece.shape)).toBeLessThan(0.001);
  });
});

describe("the Dial deck example", () => {
  const load = () => JSON.parse(readFileSync(new URL("../examples/dial-deck.json", import.meta.url), "utf8"));

  it("fits in one piece with no seam, with its top in black", () => {
    const { printedParts } = plan(load());
    expect(printedParts.map((p) => [p.name, p.color])).toEqual([
      ["Shell", load().enclosure.color ?? "#cfc7b4"],
      ["Face", "#1b1c1f"],
      ["Plate", load().enclosure.color ?? "#cfc7b4"],
    ]);
  });

  it("builds with nothing colliding, and each boss attached to a wall", async () => {
    await initEngine();
    const buildPlan = plan(load());
    const { parts } = buildEnclosure(buildPlan);
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) expect(overlap(parts[i]!.shape, parts[j]!.shape), `${parts[i]!.name} and ${parts[j]!.name}`).toBeLessThan(0.01);
    }
    expect(buildPlan.plate!.shortBosses.filter(Boolean).length).toBeGreaterThan(0);
    const shell = parts.find((p) => p.kind === "shell")!.shape;
    for (const [x, y] of buildPlan.plate!.screws) {
      // Above its underside, which slopes up from the wall as the shell prints upright.
      const wallProbe = (dx: number, dy: number) => makeCylinder(0.3, 3, [x + dx, y + dy, 11], [0, 0, 1]);
      const r = 3.4;
      const solid = [[r, 0], [-r, 0], [0, r], [0, -r]].map(([dx, dy]) => overlap(shell, wallProbe(dx!, dy!)) / measureVolume(wallProbe(dx!, dy!)));
      expect(Math.min(...solid), `boss at ${x}, ${y}`).toBeGreaterThan(0.999);
    }
  });
});

describe("top screw tabs side by side", () => {
  // A plain box with its top split in half, whose two front tabs land exactly 12 mm apart unless
  // something stops them, since an upright shell's tabs don't spread along the wall.
  const splitBox = () => ({
    schemaVersion: 1,
    name: "tabs",
    enclosure: { width: 100, frontHeight: 40, surfaces: [{ id: "top", y: 100, z: 40 }], wall: 2.4, floorThickness: 2.4 },
    topPanels: [{ surface: "top", splits: [50] }],
  });
  // Rear tabs either side of an opening, which reach into it unless something stops them.
  const withOpening = () => ({
    schemaVersion: 1,
    name: "tabs",
    enclosure: { width: 220, frontHeight: 15, surfaces: [{ id: "top", y: 100, z: 40 }, { id: "mid", y: 140, z: 40 }, { id: "back", y: 180, z: 30 }], wall: 3, floorThickness: 3, cornerRadius: 6, panelThickness: 1.6, rounds: { rearTop: 8 } },
    topPanels: [{ surface: "top" }, { surface: "mid" }],
    seams: [{ x: 110 }],
    opening: { xMin: 66, xMax: 132, yEnd: 162, sill: 0 },
  });
  const extents = (built: ReturnType<typeof plan>, wall: string) =>
    built.topScrews.filter((s) => s.wall === wall).map((s) => (built.shellOnSide ? [s.x - 14, s.x + 14] : [s.x - 6, s.x + 6]) as readonly [number, number]).sort((a, b) => a[0] - b[0]);
  const closedMeshes = async (config: unknown) => {
    await initEngine();
    const results: boolean[] = [];
    for (const part of buildEnclosure(plan(config)).parts) {
      const bytes = new Uint8Array(await part.shape.blobSTL({ binary: true, tolerance: 0.1, angularTolerance: 0.3 }).arrayBuffer());
      results.push(analyseBinarySTL(bytes).watertight);
    }
    return results.every(Boolean);
  };

  it("never just touch", () => {
    const tabs = extents(plan(splitBox()), "front");
    expect(tabs.length).toBeGreaterThan(1);
    for (const [i, tab] of tabs.entries()) {
      for (const other of tabs.slice(i + 1)) expect(Math.abs(other[0] - tab[1])).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("make a closed mesh on a split top", async () => {
    expect(await closedMeshes(splitBox())).toBe(true);
  });

  it("stay out of an opening", () => {
    const tabs = extents(plan(withOpening()), "rear");
    expect(tabs.length).toBeGreaterThan(0);
    for (const [low, high] of tabs) expect(high <= 66 || low >= 132).toBe(true);
  });

  it("make a closed mesh beside an opening", async () => {
    expect(await closedMeshes(withOpening())).toBe(true);
  });
});
