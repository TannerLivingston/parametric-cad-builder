// The promise the validator makes: whatever it accepts, the engine builds correctly.
import { beforeAll, describe, expect, it } from "vitest";
import { importSTEP, makeBox, makeCylinder, measureVolume, type Shape3D } from "replicad";
import { BOLT_DIAMETER } from "../src/engine.js";
import { PIN_SOCKET_DIAMETER } from "../src/plate.js";
import { BOSS_DIAMETER, COUNTERSINK_DEPTH, COUNTERSINK_DIAMETER, INSERT_HOLE_DEPTH, INSERT_HOLE_DIAMETER, SCREW_CLEARANCE_DIAMETER } from "../src/plate.js";
import { surfacePoint } from "../src/profile.js";
import { buildEnclosure, initEngine, recutPart } from "../src/index.js";
import { blank, deckAndPanel, deskSynth, wedge } from "./helpers.js";
import { buildProblems, overlap, plan, stlBytes } from "./buildChecks.js";

beforeAll(async () => {
  await initEngine();
});

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
    // Past the countersink, and past the 45 degree roof over its bore's teardrop point.
    const coneEnd = Math.max(seam.x - half + COUNTERSINK_DEPTH + 0.2, seam.x - half + (COUNTERSINK_DIAMETER / 2) * Math.SQRT1_2 + 0.1);
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
