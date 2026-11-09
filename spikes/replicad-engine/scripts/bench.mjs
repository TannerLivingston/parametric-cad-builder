// Timings in Node, plus a determinism check across two separate builds.
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { runBench } from "../src/bench.js";
import { buildEnclosure, referenceConfig } from "../src/enclosure.js";
import { sha256, stripStepTimestamp } from "../src/checks.js";

const silent = () => {};
const oc = await opencascade({ print: silent, printErr: silent });
setOC(oc);

async function fingerprint() {
  const { left, right } = buildEnclosure(referenceConfig());
  const out = {};
  for (const [name, part] of [["left", left], ["right", right]]) {
    const stl = new Uint8Array(await part.blobSTL({ binary: true, tolerance: 0.05, angularTolerance: 0.2 }).arrayBuffer());
    const step = await part.blobSTEP().text();
    out[`${name}STL`] = await sha256(stl);
    out[`${name}STEP`] = await sha256(stripStepTimestamp(step));
  }
  return out;
}

const first = await fingerprint();
const second = await fingerprint();
const results = runBench({
  log: (message) => console.error(`  ${message}`),
  heapBytes: () => oc.wasmMemory?.buffer.byteLength ?? oc.HEAPU8?.byteLength ?? null,
});
const third = await fingerprint();

results.determinism = Object.fromEntries(
  Object.keys(first).map((k) => [k, { sameInProcess: first[k] === second[k], sameAfterHeavyUse: first[k] === third[k] }]),
);
console.log(JSON.stringify(results, null, 2));
