// Inlaid labels: a body of their own, in a second colour, filling the engraving.
import { beforeAll, describe, expect, it } from "vitest";
import { measureVolume, type Shape3D } from "replicad";
import { isValidSolid } from "../src/checks.js";
import { labelInlays } from "../src/engine.js";
import { buildEnclosure, initEngine, planPrint, printGuide, validateConfig, type BuildPlan } from "../src/index.js";
import { bedFiles } from "../src/threeMF.js";
import { updateLabel } from "../src/app/labelEdit.js";
import { formatConfig } from "../src/app/configEdit.js";

const box = (labels: unknown[]): any => ({
  schemaVersion: 1,
  name: "labelled",
  enclosure: { width: 120, frontHeight: 30, cornerRadius: 3, surfaces: [{ id: "top", y: 80, z: 30 }] },
  topPanels: [{ surface: "top", color: "#1b1c1f" }],
  labels,
});
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const modelOf = (bytes: Uint8Array) => {
  const text = new TextDecoder().decode(bytes);
  return text.slice(text.indexOf("<model"), text.indexOf("</model>") + 8);
};
const overlap = (a: Shape3D, b: Shape3D) => {
  try {
    return measureVolume(a.intersect(b));
  } catch (error) {
    if (String(error).includes("deleted")) throw error;
    return 0;
  }
};

beforeAll(async () => {
  await initEngine();
}, 60_000);

describe("an inlaid label", () => {
  const config = box([
    { text: "VOL", u: 60, v: 40, size: 8, color: "#f2f2f2" },
    { text: "MIX", u: 60, v: 60, size: 6 },
  ]);

  it("is turned on and off in the form, leaving no colour in the file when off", () => {
    const off = updateLabel(config, 0, { color: undefined });
    expect(formatConfig(off)).not.toContain("#f2f2f2");
    expect(updateLabel(off, 1, { color: "#ff0000" }).labels[1].color).toBe("#ff0000");
  });

  it("keeps its colour in the plan, and plain ones stay engraved", () => {
    const placed = plan(config);
    expect(placed.labels.map((label) => label.color)).toEqual(["#f2f2f2", undefined]);
  });

  it("fills exactly what its engraving took out of the part, and nothing else", () => {
    const placed = plan(config);
    const index = placed.labels[0]!.printedPart;
    const part = buildEnclosure(placed).parts[index]!;
    const inlays = labelInlays(placed, index, part.blank);
    expect(inlays.map((inlay) => inlay.color)).toEqual(["#f2f2f2"]);
    const inlay = inlays[0]!.shape;
    expect(isValidSolid(inlay)).toBe(true);
    expect(overlap(inlay, part.shape)).toBeLessThan(0.001);
    // Only the inlaid label's share of what was engraved, since "MIX" stays engraved.
    const plain = plan(box([{ text: "MIX", u: 60, v: 60, size: 6 }]));
    const plainPart = buildEnclosure(plain).parts[index]!;
    const vol = measureVolume(part.blank) - measureVolume(part.cut) - (measureVolume(plainPart.blank) - measureVolume(plainPart.cut));
    expect(measureVolume(inlay)).toBeCloseTo(vol, 1);
  }, 120_000);

  it("goes in its bed's 3MF as one object with the part, each in its colour, and in the guide", () => {
    const placed = plan(config);
    const { parts } = buildEnclosure(placed);
    const reports = planPrint(placed, parts.map((p) => p.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    const index = placed.labels[0]!.printedPart;
    const mesh = (shape: Shape3D) => shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 });
    const files = bedFiles(placed, reports, (i) => mesh(parts[i]!.shape), (i) => labelInlays(placed, i, parts[i]!.blank).map((inlay) => ({ color: inlay.color, mesh: mesh(inlay.shape) })));
    const withInlay = files.map((file) => modelOf(file.bytes)).find((model) => model.includes("<components>"))!;
    expect(withInlay).toContain(`name="${placed.printedParts[index]!.name} labels"`);
    expect(withInlay.match(/<component objectid=/g)).toHaveLength(2);
    expect(withInlay).toContain('displaycolor="#F2F2F2FF"');
    expect(withInlay).toContain('displaycolor="#1B1C1FFF"');
    expect(printGuide(placed, reports)).toContain(`- ${placed.printedParts[index]!.name}: its labels in #f2f2f2, on #1b1c1f.`);
  }, 120_000);
});
