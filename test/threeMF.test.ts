// A 3MF for each shared bed, with its parts already placed.
import { beforeAll, describe, expect, it } from "vitest";
import { makeBox, type Shape3D } from "replicad";
import { bedsFor } from "../src/bedLayout.js";
import { buildEnclosure, initEngine, placedOnBed, planPrint, validateConfig, type BuildPlan } from "../src/index.js";
import { bedFiles, placeMesh, write3mf } from "../src/threeMF.js";
import { deskSynth } from "./helpers.js";

// The zip stores files as they are, so the model's text can be read straight out of it.
const modelOf = (bytes: Uint8Array) => {
  const text = new TextDecoder().decode(bytes);
  return text.slice(text.indexOf("<model"), text.indexOf("</model>") + 8);
};
const objectsOf = (model: string) =>
  [...model.matchAll(/<object id="(\d+)" type="model" name="([^"]*)"[^>]*><mesh><vertices>(.*?)<\/vertices><triangles>(.*?)<\/triangles>/g)].map(([, id, name, vertices, triangles]) => ({
    id: Number(id),
    name,
    points: [...vertices!.matchAll(/x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]),
    triangles: [...triangles!.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]),
  }));
const boundsOf = (points: number[][]) => [0, 1, 2].map((axis) => [Math.min(...points.map((p) => p[axis]!)), Math.max(...points.map((p) => p[axis]!))]);

beforeAll(async () => {
  await initEngine();
}, 180_000);

describe("a bed's 3MF", () => {
  const cube = () => (makeBox([-10, -20, 0], [10, 20, 5]) as unknown as Shape3D).mesh({ tolerance: 0.1, angularTolerance: 0.3 });

  it("moves a part to its spot, turned a quarter if asked", () => {
    const flat = boundsOf(chunk(placeMesh("a", cube(), { x: 30, y: 40, turned: false }).vertices));
    expect(flat).toEqual([[30, 50], [40, 80], [0, 5]]);
    const turned = boundsOf(chunk(placeMesh("a", cube(), { x: 30, y: 40, turned: true }).vertices));
    expect(turned).toEqual([[30, 70], [40, 60], [0, 5]]);
  });

  it("holds each part as a closed mesh with shared corners, in millimetres, by name", () => {
    const model = modelOf(write3mf([placeMesh("Deck & rail", cube(), { x: 5, y: 5, turned: false }), placeMesh("Rail", cube(), { x: 60, y: 5, turned: false })]));
    expect(model).toContain('unit="millimeter"');
    const objects = objectsOf(model);
    expect(objects.map((o) => o.name)).toEqual(["Deck &amp; rail", "Rail"]);
    for (const object of objects) {
      expect(object.points).toHaveLength(8);
      expect(object.triangles).toHaveLength(12);
      // Every edge of a closed mesh is shared by exactly two triangles.
      const edges = new Map<string, number>();
      for (const [a, b, c] of object.triangles) for (const [p, q] of [[a, b], [b, c], [c, a]]) edges.set([p, q].sort().join(), (edges.get([p, q].sort().join()) ?? 0) + 1);
      expect([...edges.values()].every((n) => n === 2)).toBe(true);
    }
    expect(model.match(/<item objectid=/g)).toHaveLength(2);
  });

  it("isn't made for a bed with one part, which its own file already covers", () => {
    const part = (index: number, color: string) => ({ index, name: `Part ${index}`, best: { size: [40, 20, 5] }, estimate: { hours: 1, grams: 1 }, color });
    const plan = { printedParts: [part(0, "#000"), part(1, "#fff")], config: { fabrication: { buildVolume: { x: 256, y: 256, z: 256 } } } } as unknown as BuildPlan;
    const reports = plan.printedParts as unknown as Parameters<typeof bedFiles>[1];
    expect(bedFiles(plan, reports, () => cube())).toEqual([]);
  });

  it("comes for each Desk Synth bed with more than one part, its parts on the bed and apart", () => {
    const plan = (validateConfig(deskSynth()) as { plan: BuildPlan }).plan;
    const { parts } = buildEnclosure(plan);
    const reports = planPrint(plan, parts.map((p) => p.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    const meshOf = (index: number) => placedOnBed(parts[index]!.shape, reports[index]!.best.matrix, reports[index]!.best.offset).mesh({ tolerance: 0.1, angularTolerance: 0.3 });
    const files = bedFiles(plan, reports, meshOf);
    const beds = bedsFor(plan, reports);
    expect(files.map((f) => f.name)).toEqual(beds.flatMap((bed, i) => (bed.items.length > 1 ? [`bed-${i + 1}.3mf`] : [])));
    const { x, y } = plan.config.fabrication.buildVolume;
    for (const file of files) {
      const boxes = objectsOf(modelOf(file.bytes)).map((o) => boundsOf(o.points));
      expect(boxes.length).toBeGreaterThan(1);
      for (const [bx, by, bz] of boxes) {
        expect(bx![0]).toBeGreaterThanOrEqual(4.99);
        expect(bx![1]).toBeLessThanOrEqual(x - 4.99);
        expect(by![1]).toBeLessThanOrEqual(y - 4.99);
        expect(bz![0]).toBeCloseTo(0, 1);
      }
      boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(Math.max(b[0]![0]! - a[0]![1]!, a[0]![0]! - b[0]![1]!, b[1]![0]! - a[1]![1]!, a[1]![0]! - b[1]![1]!)).toBeGreaterThan(4.9)));
    }
  }, 120_000);
});

function chunk(values: number[]) {
  return Array.from({ length: values.length / 3 }, (_, i) => values.slice(i * 3, i * 3 + 3));
}
