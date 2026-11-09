import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { configJsonSchema, configSchema, library, validateConfig } from "../src/index.js";
import { blank, errors, deskSynth } from "./helpers.js";

describe("config schema", () => {
  it("accepts the Desk Synth example", () => {
    expect(configSchema.safeParse(deskSynth()).success).toBe(true);
  });

  it("fills in defaults for a minimal config", () => {
    const parsed = configSchema.parse(blank());
    expect(parsed.enclosure.wall).toBe(3);
    expect(parsed.fabrication).toEqual({
      material: "PETG",
      fitTestParts: [],
      buildVolume: { x: 256, y: 256, z: 256 },
      fit: { insertHole: 4, insertHoleSideways: 4, screwHole: 3.4, clipGap: 0.2, pinSocket: 4.3, partHoles: {}, knobHole: 0.1 },
    });
    expect(parsed.seams[0]).toEqual({ x: 152.4, ribWidth: 9, ribHalfThickness: 5 });
  });

  it("rejects a fit setting that couldn't work", () => {
    const fit = (values: unknown) => errors(blank({ fabrication: { fit: values } }))[0];
    expect(fit({ insertHole: 7 })).toMatchObject({ code: "SCHEMA_INVALID", path: "fabrication.fit.insertHole" });
    expect(fit({ screwHole: 6 })).toMatchObject({ code: "SCHEMA_INVALID", path: "fabrication.fit.screwHole" });
    expect(fit({ partHoles: { "arcade-24mm": 3 } })).toMatchObject({ code: "SCHEMA_INVALID" });
    expect(fit({ insertHoles: 4 })).toMatchObject({ code: "SCHEMA_INVALID" });
  });

  it("rejects unknown keys, so a typo can't be silently ignored", () => {
    const config = blank();
    config.enclosure.tiltDegrees = 6;
    expect(errors(config)[0]).toMatchObject({ code: "SCHEMA_INVALID", path: "enclosure" });
  });

  it.each([
    ["a negative width", (c: any) => (c.enclosure.width = -1), "enclosure.width"],
    ["no surfaces", (c: any) => (c.enclosure.surfaces = []), "enclosure.surfaces"],
    ["an unknown material", (c: any) => (c.fabrication = { material: "ABS" }), "fabrication.material"],
    ["an unsupported schema version", (c: any) => (c.schemaVersion = 2), "schemaVersion"],
    ["two seams", (c: any) => (c.seams = [{ x: 100 }, { x: 200 }]), "seams"],
    ["a non-quarter-turn rotation", (c: any) => (c.components = [{ id: "a", type: "ttp223", u: 50, v: 50, rotationDeg: 45 }]), "components[0]"],
    ["NaN", (c: any) => (c.enclosure.frontHeight = Number.NaN), "enclosure.frontHeight"],
  ])("rejects %s, and says where", (_name, mutate, path) => {
    const config = blank();
    mutate(config);
    const found = errors(config);
    expect(found[0]?.code).toBe("SCHEMA_INVALID");
    expect(found.map((e) => e.path).join(" ")).toContain(path);
  });

  it("exports a JSON Schema, for editors and an LLM front end", () => {
    const schema = configJsonSchema() as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(expect.arrayContaining(["schemaVersion", "name", "enclosure"]));
    expect(schema.properties).toHaveProperty("components");
  });

  it("marks the parts from the Desk Synth model as measured, and nothing else", () => {
    const measured = Object.entries(library).filter(([, part]) => part.source === "measured").map(([id]) => id);
    expect(measured.sort()).toEqual(["ads7830", "arcade-24mm", "ec11-dial-19mm", "ec11-dial-30mm", "encoder-board-5752", "oled-242-ssd1309", "perfboard-7x9", "rp2040-plus"]);
  });
});

describe("the README", () => {
  it("has a sample config that works", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const sample = /## Config[\s\S]*?```json\n([\s\S]*?)```/.exec(readme)![1]!;
    const result = validateConfig(JSON.parse(sample));
    expect(result.ok ? [] : result.errors.map((e) => e.message)).toEqual([]);
  });
});
