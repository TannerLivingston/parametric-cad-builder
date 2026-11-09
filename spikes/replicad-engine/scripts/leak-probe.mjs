// Runs each operation alone in a fresh instance to find which one retains memory.
// Usage: node --expose-gc scripts/leak-probe.mjs
import opencascade from "replicad-opencascadejs";
import { compoundShapes, drawCircle, makeCylinder, setOC } from "replicad";
import { applyCutouts, buildBase, cutoutsOnSide, referenceConfig, splitAndJoin } from "../src/enclosure.js";

const silent = () => {};
const yieldToLoop = () => new Promise((resolve) => setTimeout(resolve, 0));
const cfg = referenceConfig();

async function probe(label, makeBody, rounds = 400) {
  const oc = await opencascade({ print: silent, printErr: silent });
  setOC(oc);
  const body = makeBody();
  const heap = () => oc.wasmMemory.buffer.byteLength / 1048576;
  for (let i = 0; i < 50; i++) body(i); // let pools and caches reach a steady size
  const start = heap();
  for (let i = 0; i < rounds; i++) {
    body(i);
    if (i % 50 === 49) {
      await yieldToLoop();
      globalThis.gc();
      await yieldToLoop();
    }
  }
  console.log(label.padEnd(44), `${((heap() - start) * 1024 / rounds).toFixed(0).padStart(7)} KB/iter`, `heap ${heap().toFixed(0)} MB`);
}

const box = () => makeCylinder(50, 20, [0, 0, 0], [0, 0, 1]);
const pin = () => makeCylinder(5, 40, [0, 0, -10], [0, 0, 1]);

await probe("cylinder, deleted", () => () => box().delete());
await probe("cylinder, undeleted", () => () => box());
await probe("sketch and extrude, deleted", () => () => drawCircle(5).sketchOnPlane("XY").extrude(5).delete());
await probe("cut, all deleted", () => () => {
  const [a, b] = [box(), pin()];
  const r = a.cut(b);
  [a, b, r].forEach((s) => s.delete());
});
await probe("cut, simplify off, all deleted", () => () => {
  const [a, b] = [box(), pin()];
  const r = a.cut(b, { simplify: false });
  [a, b, r].forEach((s) => s.delete());
});
await probe("fuse, all deleted", () => () => {
  const [a, b] = [box(), pin()];
  const r = a.fuse(b);
  [a, b, r].forEach((s) => s.delete());
});
await probe("compound of 10, deleted", () => () => {
  const parts = Array.from({ length: 10 }, (_, i) => makeCylinder(1, 5, [i * 5, 0, 0], [0, 0, 1]));
  compoundShapes(parts).delete();
  parts.forEach((s) => s.delete());
});
await probe("buildBase, result deleted", () => () => buildBase(cfg).delete(), 100);
await probe("splitAndJoin only, results deleted", () => {
  const base = buildBase(cfg);
  return () => {
    const { left, right } = splitAndJoin(base, cfg);
    left.delete();
    right.delete();
  };
}, 100);
await probe("applyCutouts (8) only, result deleted", () => {
  const { left } = splitAndJoin(buildBase(cfg), cfg);
  const cuts = cutoutsOnSide(cfg, "left");
  return () => applyCutouts(left, cuts, cfg).delete();
}, 100);
await probe("applyCutouts (22) only, result deleted", () => {
  const { right } = splitAndJoin(buildBase(cfg), cfg);
  const cuts = cutoutsOnSide(cfg, "right");
  return () => applyCutouts(right, cuts, cfg).delete();
}, 100);
await probe("mesh only", () => {
  const { left } = splitAndJoin(buildBase(cfg), cfg);
  return () => left.mesh({ tolerance: 0.1, angularTolerance: 0.3 });
}, 100);
