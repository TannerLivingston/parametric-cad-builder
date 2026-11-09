// Validates a config, builds it, checks the result, and writes STL and STEP files.
// Usage: npm run build -- <config.json> [outputDir]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { measureVolume } from "replicad";
import { analyseBinarySTL, isValidSolid } from "../src/checks.js";
import { bedFiles } from "../src/threeMF.js";
import { buildEnclosure, cutoutVolume, initEngine, placedOnBed, planPrint, printGuide, validateConfig } from "../src/index.js";
import { labelInlays } from "../src/engine.js";

const [file, outDir = "output"] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npm run build -- <config.json> [outputDir]");
  process.exit(2);
}

const result = validateConfig(JSON.parse(readFileSync(file, "utf8")));
for (const issue of result.warnings) console.log(`warning  ${issue.code}: ${issue.message}`);
if (!result.ok) {
  for (const issue of result.errors) console.log(`error    ${issue.code} at ${issue.path}: ${issue.message}`);
  process.exit(1);
}

const { plan } = result;
await initEngine();
const enclosure = buildEnclosure(plan);
console.log("stages (ms):", Object.fromEntries(Object.entries(enclosure.stagesMs).map(([k, v]) => [k, Math.round(v)])));

mkdirSync(outDir, { recursive: true });
let failed = false;
const thickness = plan.config.enclosure.panelThickness;
const reports = planPrint(plan, enclosure.parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
writeFileSync(join(outDir, "how-to-print.txt"), printGuide(plan, reports));
for (const part of enclosure.parts) {
  const name = part.name.toLowerCase().replace(/ /g, "-");
  const { best } = reports[part.index]!;
  const placed = placedOnBed(part.shape, best.matrix, best.offset);
  const stl = new Uint8Array(await placed.blobSTL({ binary: true, tolerance: 0.05, angularTolerance: 0.2 }).arrayBuffer());
  writeFileSync(join(outDir, `${name}.stl`), stl);
  writeFileSync(join(outDir, `${name}.step`), new Uint8Array(await placed.blobSTEP().arrayBuffer()));

  const mesh = analyseBinarySTL(stl);
  const volume = measureVolume(part.shape);
  const removed = measureVolume(part.blank) - measureVolume(part.cut);
  const expected = plan.cutouts.filter((c) => c.printedPart === part.index).reduce((sum, c) => sum + cutoutVolume(c, thickness), 0);
  const checks = {
    validSolid: isValidSolid(part.shape),
    watertight: mesh.watertight,
    cutVolumeWithin1pct: expected === 0 || Math.abs(removed - expected) / expected < 0.01,
    meshVolumeWithin1pct: Math.abs(mesh.volume - volume) / volume < 0.01,
  };
  if (Object.values(checks).includes(false)) failed = true;
  console.log(name, {
    prints: best.label,
    supports: reports[part.index]!.needsSupport,
    sizeMm: mesh.size.map((s) => Math.round(s * 10) / 10),
    volumeMm3: Math.round(volume),
    removedMm3: Math.round(removed * 10) / 10,
    expectedRemovedMm3: Math.round(expected * 10) / 10,
    triangles: mesh.triangles,
    checks,
  });
}
const inlaysOf = (index: number) => {
  const { best } = reports[index]!;
  return labelInlays(plan, index, enclosure.parts[index]!.blank).map((inlay) => ({ color: inlay.color, mesh: placedOnBed(inlay.shape, best.matrix, best.offset).mesh({ tolerance: 0.05, angularTolerance: 0.2 }) }));
};
for (const file of bedFiles(plan, reports, (index) => {
  const { best } = reports[index]!;
  return placedOnBed(enclosure.parts[index]!.shape, best.matrix, best.offset).mesh({ tolerance: 0.05, angularTolerance: 0.2 });
}, inlaysOf)) {
  writeFileSync(join(outDir, file.name), file.bytes);
  console.log(file.name);
}
console.log("hardware:", plan.hardware.map((h) => `${h.count} x ${h.name}`).join(", "));
console.log("putting it together:");
plan.assembly.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
console.log(failed ? "FAILED" : `All checks passed. Files are in ${outDir}/`);
process.exit(failed ? 1 : 0);
