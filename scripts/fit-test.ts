// Writes a fit test for a design, with what each row is for.
// Usage: npm run fit-test -- <config.json> [outputDir]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyseBinarySTL, isValidSolid } from "../src/checks.js";
import { buildEnclosure, buildFitTest, fitStepSize, initEngine, planFitTest, validateConfig } from "../src/index.js";

const [file, outDir = "output/fit-test"] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npm run fit-test -- <config.json> [outputDir]");
  process.exit(2);
}

const result = validateConfig(JSON.parse(readFileSync(file, "utf8")));
if (!result.ok) {
  for (const issue of result.errors) console.log(`error    ${issue.code} at ${issue.path}: ${issue.message}`);
  process.exit(1);
}

const plan = planFitTest(result.plan);
await initEngine();
mkdirSync(outDir, { recursive: true });
let failed = false;
for (const part of buildFitTest(plan, buildEnclosure(result.plan).parts.map((p) => p.shape))) {
  const name = part.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const stl = new Uint8Array(await part.shape.blobSTL({ binary: true, tolerance: 0.05, angularTolerance: 0.2 }).arrayBuffer());
  writeFileSync(join(outDir, `${name}.stl`), stl);
  writeFileSync(join(outDir, `${name}.step`), new Uint8Array(await part.shape.blobSTEP().arrayBuffer()));
  const mesh = analyseBinarySTL(stl);
  const valid = isValidSolid(part.shape);
  if (!valid || !mesh.watertight) failed = true;
  console.log(part.name, { sizeMm: mesh.size.map((s) => Math.round(s * 10) / 10), valid, watertight: mesh.watertight });
}
console.log("\nPrint them as exported. You'll need:", plan.hardware.join("; "));
for (const row of plan.rows) {
  const sizes = row.steps.map((step) => (step.pips ? `${step.pips} ${step.pips === 1 ? "dot" : "dots"}: ${fitStepSize(row, step)}` : `as designed`)).join(", ");
  const setting = row.setting === "plateClearance" ? "plate.clearance" : row.setting === "wallHole" ? `fitChange on wall hole ${row.parts.join(", ")}` : `fabrication.fit.${row.setting}`;
  console.log(`\nRow ${row.number}: ${row.title}\n  ${row.how}\n  ${sizes}\n  Sets ${setting}${row.setting === "partHoles" ? ` for ${row.parts.join(", ")}` : ""}`);
}
process.exit(failed ? 1 : 0);
