// Wires: room where they leave each part, their routes across the floor, and cable ties along them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateConfig, type BuildPlan } from "../src/index.js";
import { printGuide } from "../src/printing.js";
import { cableTieSpots, routeWire, WIRE_BUNDLE, type FloorBlock } from "../src/wiring.js";
import { setShiftRegisters, setWiringChecks, tiesAlongWires } from "../src/app/shapeEdit.js";
import { formatConfig } from "../src/app/configEdit.js";

// A flat top at z = 40 over a 160 x 120 box, with a microcontroller on the floor.
const box = (components: unknown[], more: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "w",
  enclosure: { width: 160, frontHeight: 40, surfaces: [{ id: "top", y: 120, z: 40 }] },
  components: [{ id: "mcu", type: "rp2040-plus", x: 40, y: 90 }, ...components],
  ...more,
});
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const wireIssues = (config: unknown) => {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.warnings.filter((w) => w.code.startsWith("WIRE"));
};
const dial = (id: string, u: number, v: number) => ({ id, type: "ec11-dial-19mm", surface: "top", u, v });
const deskSynth = () => JSON.parse(readFileSync(new URL("../examples/desk-synth.json", import.meta.url), "utf8"));

describe("room for wires", () => {
  it("runs straight out of a part, from the face its wires leave by", () => {
    const built = plan(box([dial("d", 110, 40)]));
    const room = built.wiring.rooms.find((r) => r.componentId === "d")!;
    // An EC11 is 11.5 mm deep under a 3 mm top, and its pins need 10 mm more.
    const zs = room.prism.section.map(([, z]) => z);
    expect(Math.max(...zs)).toBeCloseTo(40 - 3 - 11.5);
    expect(Math.min(...zs)).toBeCloseTo(40 - 3 - 11.5 - 10);
    expect(room.end).toEqual([110, 40, expect.closeTo(40 - 3 - 11.5 - 10)]);
    // A board's headers stand up from its top.
    const header = built.wiring.rooms.find((r) => r.componentId === "mcu")!;
    expect(Math.min(...header.prism.section.map(([, z]) => z))).toBeCloseTo(built.config.enclosure.floorThickness + 13.5);
  });

  it("warns, never errs, when something's in the way, and says what", () => {
    // The perfboard's top is 19.6 mm up, and the dial's pins need down to 15.5.
    const low = box([dial("d", 110, 40), { id: "b", type: "perfboard-7x9", x: 112, y: 52, rotationDeg: 90 }]);
    expect(validateConfig(low).ok).toBe(true);
    const [issue] = wireIssues(low).filter((w) => w.code === "WIRE_ROOM");
    expect(issue).toMatchObject({ severity: "warning", componentIds: ["d"] });
    expect(issue!.message).toContain('the body of "b"');
  });

  it("does with one end of a board with a plug at each, if the other is blocked", () => {
    const ads = (gap: number) => box([{ id: "a", type: "ads7830", x: 60, y: 40, rotationDeg: 90 }, { id: "b", type: "ads7830", x: 60 + 42.5 + gap, y: 40, rotationDeg: 90 }]);
    // They face each other end to end with only 6 mm between, but each has its other end free.
    expect(wireIssues(ads(6)).filter((w) => w.code === "WIRE_ROOM")).toEqual([]);
    // Unless it's blocked too, by the right wall.
    const blocked = box([{ id: "a", type: "ads7830", x: 84.5, y: 40, rotationDeg: 90 }, { id: "b", type: "ads7830", x: 133, y: 40, rotationDeg: 90 }]);
    expect(wireIssues(blocked).filter((w) => w.code === "WIRE_ROOM").map((w) => w.componentIds)).toEqual([["b"]]);
  });

  it("asks nothing of a part whose body takes in its plugs", () => {
    expect(wireIssues(deskSynth()).filter((w) => w.componentIds?.some((id) => id.startsWith("button")) && w.code === "WIRE_ROOM")).toEqual([]);
  });

  it("is all turned off in one place, leaving the rooms and routes to look at", () => {
    const low = box([dial("d", 110, 40), { id: "b", type: "ads7830", x: 110, y: 40 }]);
    const off = setWiringChecks(low, false);
    expect(off.wiring).toEqual({ checks: false });
    expect(wireIssues(off)).toEqual([]);
    expect(plan(off).wiring.rooms.length).toBeGreaterThan(0);
    expect(plan(off).wiring.routes.length).toBeGreaterThan(0);
    // On again is the default, so it leaves the file, and the shift registers stay put.
    expect(formatConfig(setWiringChecks(off, true))).not.toContain("wiring");
    expect(setWiringChecks(setShiftRegisters(off, 2), true).wiring).toEqual({ shiftRegisters: 2 });
    expect(setShiftRegisters(off, 2).wiring).toEqual({ checks: false, shiftRegisters: 2 });
  });
});

describe("routes across the floor", () => {
  it("go round what's on the floor, to the board", () => {
    const area = { xMin: 0, xMax: 100, yMin: 0, yMax: 60, floor: 2 };
    const board: FloorBlock = { xLow: 80, xHigh: 95, yLow: 20, yHigh: 40, componentId: "mcu" };
    const from = { id: "p", end: [10, 30, 30] as [number, number, number] };
    const open = routeWire(area, [], from, { id: "mcu", box: board, top: 15 }, [])!;
    expect(open.tight).toBe(false);
    // A wall across the way, with a gap at one end, makes it go round.
    const wall: FloorBlock = { xLow: 45, xHigh: 50, yLow: 0, yHigh: 50 };
    const round = routeWire(area, [wall], from, { id: "mcu", box: board, top: 15 }, [])!;
    expect(round.length).toBeGreaterThan(open.length + 10);
    expect(round.points.some(([, y]) => y > 50)).toBe(true);
    // Less than a bundle's room, it squeezes through, and says so. None at all, and there's no route.
    const narrow: FloorBlock = { xLow: 45, xHigh: 50, yLow: 0, yHigh: 60 - WIRE_BUNDLE / 2 + 1 };
    expect(routeWire(area, [narrow], from, { id: "mcu", box: board, top: 15 }, [])!.tight).toBe(true);
    expect(routeWire(area, [{ ...wall, yHigh: 60 }], from, { id: "mcu", box: board, top: 15 }, [])).toBeNull();
    // And it counts the seams it crosses, the same way each time.
    const again = routeWire(area, [wall], from, { id: "mcu", box: board, top: 15 }, [30, 70])!;
    expect(again.seams).toEqual([30, 70]);
    expect(again.points).toEqual(round.points);
  });

  it("goes from each part to the microcontroller, or a switch to a shift register board", () => {
    const built = plan(box([dial("d", 110, 40), { id: "s", type: "arcade-24mm", surface: "top", u: 110, v: 90 }, { id: "sr", type: "shift-74hc165", x: 120, y: 30 }]));
    const to = Object.fromEntries(built.wiring.routes.map((route) => [route.from, route.to]));
    // The dial has encoder pins as well as its switch, so it goes to the microcontroller.
    expect(to).toEqual({ d: "mcu", s: "sr", sr: "mcu" });
  });

  it("marks wires that cross the seam in the list, without a warning", () => {
    const seamed = box([dial("d", 130, 40), dial("e", 140, 70)], { seams: [{ x: 80 }] });
    expect(wireIssues(seamed).filter((w) => w.componentIds?.includes("d") || w.componentIds?.includes("e"))).toEqual([]);
    expect(printGuide(plan(seamed), [])).toMatch(/- d to mcu: about \d+0 mm, across the seam\./);
  });

  it("lists each run's length in the print guide", () => {
    const built = plan(box([dial("d", 110, 40)]));
    expect(printGuide(built, [])).toMatch(/Wires\n.*\n- d to mcu: about \d+0 mm\./);
  });

  it("finds the Desk Synth's encoder board on the far side of its seam", () => {
    const built = plan(deskSynth());
    expect(built.wiring.routes.find((route) => route.from === "encoders-right")!.seams).toEqual([built.seams[0]!.x]);
  });
});

describe("cable ties along the wires", () => {
  it("go every so far along the routes, turned to wrap them, and shared where they run together", () => {
    const route = { from: "a", to: "b", length: 0, tight: false, seams: [], points: [[0, 0], [200, 0], [200, 100]] as [number, number][] };
    const spots = cableTieSpots([route, { ...route, from: "c" }]);
    expect(spots.map((s) => [s.x, s.y, s.rotationDeg])).toEqual([[30, 0, 0], [90, 0, 0], [150, 0, 0], [200, 10, 90], [200, 70, 90]]);
  });

  it("are added where the validator takes them, and don't turn the routes aside", () => {
    const config = box([dial("d", 130, 20), dial("e", 130, 60)]);
    const before = plan(config).wiring.routes;
    const next = tiesAlongWires(config);
    expect(next.plate.cableTies.length).toBeGreaterThan(0);
    expect(validateConfig(next).ok).toBe(true);
    expect(plan(next).wiring.routes).toEqual(before);
    // Again, they're there already, so nothing changes.
    expect(tiesAlongWires(next).plate.cableTies).toEqual(next.plate.cableTies);
  });

  it("leaves out those the validator won't take", () => {
    const desk = deskSynth();
    const spots = cableTieSpots(plan(desk).wiring.routes);
    const next = tiesAlongWires(desk);
    expect(next.plate.cableTies.length).toBeGreaterThan(0);
    expect(next.plate.cableTies.length).toBeLessThan(spots.length);
    expect(validateConfig(next).ok).toBe(true);
  });
});

describe("validating without the wires", () => {
  it("leaves out their rooms, routes and warnings, and nothing else", () => {
    const config = deskSynth();
    const full = validateConfig(config);
    const bare = validateConfig(config, { wiring: false });
    if (!full.ok || !bare.ok) throw new Error("invalid");
    expect(bare.plan.wiring).toEqual({ rooms: [], routes: [] });
    expect(bare.warnings).toEqual(full.warnings.filter((w) => !w.code.startsWith("WIRE")));
    expect({ ...bare.plan, wiring: null }).toEqual({ ...full.plan, wiring: null });
  });
});

describe("the 2.42 inch OLED's wires", () => {
  it("go straight down or out past its end, so only both blocked warns", () => {
    expect(wireIssues(deskSynth()).filter((w) => w.componentIds?.includes("display"))).toEqual([]);
    // A board on the floor under its header, at its left end, and a dial beside that end, block both.
    const oled = { id: "o", type: "oled-242-ssd1309", surface: "top", u: 90, v: 60 };
    const under = { id: "b", type: "shift-74hc165", x: 59, y: 60 };
    expect(wireIssues(box([oled])).filter((w) => w.componentIds?.includes("o"))).toEqual([]);
    expect(wireIssues(box([oled, under])).filter((w) => w.componentIds?.includes("o"))).toEqual([]);
    const blocked = wireIssues(box([oled, under, dial("d", 48, 60)])).filter((w) => w.componentIds?.includes("o"));
    expect(blocked).toHaveLength(1);
  });
});
