// Pin budgets: how many of the microcontroller's pins a design uses, and an I2C address for each part.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateConfig, type BuildPlan } from "../src/index.js";
import { library } from "../src/library.js";
import { planPins } from "../src/pins.js";
import { setShiftRegisters } from "../src/app/shapeEdit.js";

const example = (name: string) => JSON.parse(readFileSync(`examples/${name}.json`, "utf8"));
const box = (components: unknown[], overrides: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 250, frontHeight: 40, cornerRadius: 3, surfaces: [{ id: "top", y: 160, z: 40 }] },
  components: [{ id: "mcu", type: "pico-rp2350", x: 40, y: 120 }, ...components],
  ...overrides,
});
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const warnings = (config: unknown) => validateConfig(config).warnings.filter((w) => w.code === "PINS_SHORT").map((w) => w.message).join(" ");
const part = (id: string, pins: object) => ({ id, part: { pins } as never });

describe("the pin budget", () => {
  it("comes to the 9 pins the real Desk Synth's firmware uses, with an address for every part on the bus", () => {
    for (const name of ["desk-synth", "desk-synth-v2"]) {
      const pins = plan(example(name)).pins!;
      // Clock, data and latch for the shift registers; two phases for each dial; SCL and SDA.
      expect(pins.uses.map((use) => use.pins), name).toEqual([3, 4, 2]);
      expect(pins.used).toBe(9);
      expect(pins.gpio).toBe(26);
      const config = example(name);
      const typeOf = (id: string) => config.components.find((c: { id: string }) => c.id === id).type;
      expect(pins.addresses).toHaveLength(5);
      expect(new Set(pins.addresses.map((a) => a.address)).size).toBe(5);
      for (const { id, address } of pins.addresses) expect(library[typeOf(id)]!.pins!.i2c).toContain(address);
    }
  });

  it("counts nothing with no microcontroller in the design", () => {
    const config = box([]);
    config.components = [];
    expect(plan(config).pins).toBeNull();
  });

  it("wires switches straight in past what the shift registers take, and counts a shift register part", () => {
    const buttons = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, type: "arcade-24mm", u: 30 + (i % 5) * 30, v: 30 + Math.floor(i / 5) * 32 }));
    expect(plan(box(buttons)).pins!.uses).toEqual([{ what: "10 switches", pins: 10 }]);
    expect(plan(box(buttons, { wiring: { shiftRegisters: 1 } })).pins!.uses).toEqual([
      { what: "Shift registers, for 8 switches of 8 inputs", pins: 3 },
      { what: "2 switches past the shift registers", pins: 2 },
    ]);
    const withPart = plan(box([...buttons, { id: "sr", type: "shift-74hc165", x: 150, y: 120 }], { wiring: { shiftRegisters: 1 } })).pins!;
    expect(withPart.used).toBe(3);
  });

  it("takes shift registers of your own from the form, leaving the file alone at none", () => {
    expect(setShiftRegisters(box([]), 2).wiring).toEqual({ shiftRegisters: 2 });
    expect(setShiftRegisters(setShiftRegisters(box([]), 2), 0)).not.toHaveProperty("wiring");
  });

  it("warns when the pins run out, and says how to save some", () => {
    const leds = Array.from({ length: 27 }, (_, i) => ({ id: `l${i}`, type: "led-5mm", u: 20 + (i % 14) * 15, v: 30 + Math.floor(i / 14) * 20 }));
    expect(warnings(box(leds))).toContain("has 26 pins, and this needs 27");
    expect(warnings(box(leds.slice(0, 26)))).toBe("");
  });

  it("uses the microcontroller's analog pins first, then analog boards, and warns when they run out", () => {
    const faders = Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, type: "fader-60mm", u: 30 + i * 40, v: 60 }));
    expect(warnings(box(faders))).toContain("1 analog input has nothing to read it");
    const boarded = plan(box([...faders, { id: "adc", type: "ads7830", x: 150, y: 120 }])).pins!;
    expect(boarded.analogShort).toBe(0);
    expect(boarded.uses).toContainEqual({ what: "3 analog inputs", pins: 3 });
  });

  it("finds an address for each part on the bus, or names the ones left out", () => {
    // Four converters take all their addresses, so the encoder board has to go past them.
    const crowded = planPins([part("mcu", { gpio: 26 }), ...[1, 2, 3, 4].map((n) => part(`adc${n}`, { i2c: [0x48, 0x49, 0x4a, 0x4b] })), part("enc", { i2c: [0x49, 0x4a, 0x4b, 0x4c] })], 0)!;
    expect(crowded.unaddressed).toEqual([]);
    expect(crowded.addresses.find((a) => a.id === "enc")!.address).toBe(0x4c);
    const short = planPins([part("mcu", { gpio: 26 }), part("a", { i2c: [1, 2] }), part("b", { i2c: [1, 2] }), part("c", { i2c: [2] })], 0)!;
    expect(short.unaddressed).toHaveLength(1);
    expect(short.addresses.map((a) => a.address).sort()).toEqual([1, 2]);
    const screens = [0, 1, 2].map((i) => ({ id: `s${i}`, type: "oled-ssd1306", u: 40 + i * 60, v: 60 }));
    expect(warnings(box(screens))).toContain("enough I2C addresses");
  });
});
