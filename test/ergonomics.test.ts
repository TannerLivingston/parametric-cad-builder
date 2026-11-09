// Ergonomic checks: room for fingers between controls, and a screen tilted so it can be read.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/index.js";
import { TEMPLATES } from "../src/app/templates.js";

const box = (components: unknown[], top: { y: number; z: number } = { y: 120, z: 40 }, frontHeight = 40): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 200, frontHeight, cornerRadius: 3, surfaces: [{ id: "top", ...top }] },
  components,
});
const ergonomics = (config: unknown) => validateConfig(config).warnings.filter((w) => w.code === "ERGONOMICS").map((w) => w.message);
const pair = (type: string, other: string, pitch: number) => [
  { id: "a", type, surface: "top", u: 80, v: 60 },
  { id: "b", type: other, surface: "top", u: 80 + pitch, v: 60 },
];

describe("ergonomics", () => {
  it("say nothing about the examples or templates, which are comfortable", () => {
    for (const name of ["desk-synth", "desk-synth-v2", "dial-deck"]) expect(ergonomics(JSON.parse(readFileSync(`examples/${name}.json`, "utf8"))), name).toEqual([]);
    for (const template of TEMPLATES) expect(ergonomics(template.make()), template.name).toEqual([]);
  });

  it("keep 2 mm between buttons, which are pressed from above", () => {
    // 26.4 mm across their tops, so 28 mm apart leaves 1.6 mm.
    expect(ergonomics(box(pair("arcade-24mm", "arcade-24mm", 28))).join()).toContain("1.6 mm apart");
    expect(ergonomics(box(pair("arcade-24mm", "arcade-24mm", 29)))).toEqual([]);
  });

  it("keep 5 mm beside a knob, which is gripped from the side", () => {
    expect(ergonomics(box(pair("ec11-dial-19mm", "ec11-dial-19mm", 23))).join()).toContain("knob or fader");
    expect(ergonomics(box(pair("ec11-dial-19mm", "ec11-dial-19mm", 25)))).toEqual([]);
    // Next to a button, the knob's room is what counts.
    expect(ergonomics(box(pair("ec11-dial-19mm", "arcade-24mm", 26))).join()).toContain("knob or fader");
    expect(ergonomics(box(pair("ec11-dial-19mm", "arcade-24mm", 28)))).toEqual([]);
  });

  it("want a screen tilted towards you", () => {
    const screen = [{ id: "s", type: "oled-ssd1306", surface: "top", u: 100, v: 60 }];
    expect(ergonomics(box(screen)).join()).toContain("lies nearly flat");
    // 30 degrees, like the Desk Synth's.
    expect(ergonomics(box(screen, { y: 120, z: 99.3 }, 30))).toEqual([]);
    expect(ergonomics(box(screen, { y: 120, z: 30 }, 70)).join()).toContain("faces away");
  });
});
