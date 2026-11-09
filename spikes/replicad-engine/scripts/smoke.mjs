// One build, with every geometry check, and the exports written to output/.
import { mkdirSync, writeFileSync } from "node:fs";
import opencascade from "replicad-opencascadejs";
import { importSTEP, makeBox, makeCylinder, measureVolume, setOC } from "replicad";
import {
  PIN_SOCKET_DIAMETER,
  buildEnclosure,
  cutoutVolume,
  cutoutsOnSide,
  pinLength,
  referenceConfig,
  seamFasteners,
} from "../src/enclosure.js";
import { analyseMesh, brepIsValid, parseBinarySTL } from "../src/checks.js";

const BUILD_VOLUME = 256;
const STL_OPTIONS = { binary: true, tolerance: 0.05, angularTolerance: 0.2 };

const t0 = performance.now();
setOC(await opencascade({ print() {}, printErr() {} }));
console.log(`wasm init: ${(performance.now() - t0).toFixed(0)} ms`);

const cfg = referenceConfig();
console.log(`cutouts: ${cfg.cutouts.length}`);
const built = buildEnclosure(cfg);
console.log("stages (ms):", Object.fromEntries(Object.entries(built.stages).map(([k, v]) => [k, Math.round(v)])));

mkdirSync("output", { recursive: true });
let failed = false;
for (const side of ["left", "right"]) {
  const part = built[side];
  const blank = built[`${side}Blank`];
  const stl = new Uint8Array(await part.blobSTL(STL_OPTIONS).arrayBuffer());
  const stepBlob = part.blobSTEP();
  const step = new Uint8Array(await stepBlob.arrayBuffer());
  writeFileSync(`output/${side}.stl`, stl);
  writeFileSync(`output/${side}.step`, step);

  const mesh = analyseMesh(parseBinarySTL(stl));
  const reimported = await importSTEP(new Blob([step]));
  const partVolume = measureVolume(part);
  const stepVolume = measureVolume(reimported);
  const removed = measureVolume(blank) - partVolume;
  const expected = cutoutsOnSide(cfg, side).reduce((sum, c) => sum + cutoutVolume(c, cfg), 0);
  const fits = mesh.size.every((s) => s <= BUILD_VOLUME);
  const checks = {
    brepValid: brepIsValid(part),
    watertight: mesh.watertight,
    fitsBuildVolume: fits,
    cutVolumeWithin1pct: Math.abs(removed - expected) / expected < 0.01,
    stlVolumeWithin1pct: Math.abs(mesh.volume - partVolume) / partVolume < 0.01,
    stepRoundTripWithin0_1pct: Math.abs(stepVolume - partVolume) / partVolume < 0.001,
  };
  if (Object.values(checks).some((ok) => !ok)) failed = true;
  console.log(side, {
    size: mesh.size.map((s) => +s.toFixed(1)),
    brepVolume: +partVolume.toFixed(0),
    stlVolume: +mesh.volume.toFixed(0),
    stepVolume: +stepVolume.toFixed(0),
    removed: +removed.toFixed(1),
    expectedRemoved: +expected.toFixed(1),
    triangles: mesh.triangles,
    degenerate: mesh.degenerate,
    openEdges: mesh.openEdges,
    nonManifoldEdges: mesh.nonManifoldEdges,
    stlKB: Math.round(stl.length / 1024),
    stepKB: Math.round(step.length / 1024),
    checks,
  });
}
// The joint: halves must not collide, the rib must exist, sockets must be blind.
const overlapVolume = (a, b) => {
  try {
    return measureVolume(a.intersect(b));
  } catch {
    return 0; // an empty intersection has nothing to measure
  }
};
const slabArea = (part, x0, x1) => {
  const slab = makeBox([x0, -10, -10], [x1, cfg.depth + 10, cfg.rearHeight + 10]);
  return overlapVolume(part, slab) / (x1 - x0);
};
const { pins } = seamFasteners(cfg);
const rib = cfg.ribHalfThickness;
const socketEnd = cfg.seamX + pinLength(cfg) + 0.5;
const socketBacks = pins.map(([y, z]) => {
  const plug = makeCylinder(PIN_SOCKET_DIAMETER / 2, cfg.seamX + rib - socketEnd - 0.1, [socketEnd + 0.05, y, z], [1, 0, 0]);
  return overlapVolume(built.right, plug) / measureVolume(plug);
});
const joint = {
  halvesOverlapMm3: +overlapVolume(built.left, built.right).toFixed(3),
  overlapIfShifted1mmMm3: +overlapVolume(built.left, built.right.translate([-1, 0, 0])).toFixed(0), // control
  sectionAwayFromSeamMm2: +slabArea(built.leftBlank, cfg.seamX - 40, cfg.seamX - 39).toFixed(0),
  sectionAtRibMm2: +slabArea(built.leftBlank, cfg.seamX - 3, cfg.seamX - 2).toFixed(0),
  socketBackSolidFraction: socketBacks.map((f) => +f.toFixed(3)),
};
const jointChecks = {
  halvesDoNotCollide: joint.halvesOverlapMm3 < 0.001 && joint.overlapIfShifted1mmMm3 > 0,
  ribAddsMaterial: joint.sectionAtRibMm2 > joint.sectionAwayFromSeamMm2 + 500,
  socketsAreBlind: socketBacks.every((f) => f > 0.999),
};
if (Object.values(jointChecks).some((ok) => !ok)) failed = true;
console.log("joint", joint, jointChecks);

console.log(failed ? "RESULT: FAILED" : "RESULT: all checks passed");
process.exitCode = failed ? 1 : 0;
