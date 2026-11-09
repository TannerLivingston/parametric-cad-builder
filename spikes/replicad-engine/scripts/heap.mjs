// One memory strategy per process, so a crash in one cannot affect another.
// Usage: node --expose-gc scripts/heap.mjs <mode> [rebuilds]
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { buildEnclosure, referenceConfig } from "../src/enclosure.js";

Error.stackTraceLimit = 40;
const silent = () => {};
const init = async () => {
  const instance = await opencascade({ print: silent, printErr: silent });
  setOC(instance);
  return instance;
};
let oc = await init();
const heapMB = () => Math.round(oc.wasmMemory.buffer.byteLength / 1048576);
const yieldToLoop = () => new Promise((resolve) => setTimeout(resolve, 0));
const moved = (i) => {
  const cfg = referenceConfig();
  cfg.cutouts = cfg.cutouts.map((c) => (c.id === "arcade-62-50" ? { ...c, u: c.u + ((i % 10) - 5) * 0.3 } : c));
  return cfg;
};
const deleteParts = (b) => {
  for (const part of [b.base, b.leftBlank, b.rightBlank, b.left, b.right]) part.delete();
};

const strategies = {
  "yield": async (i) => {
    buildEnclosure(moved(i));
    await yieldToLoop();
  },
  "yield+gc": async (i) => {
    buildEnclosure(moved(i));
    await yieldToLoop();
    globalThis.gc();
    await yieldToLoop();
  },
  "delete": async (i) => {
    deleteParts(buildEnclosure(moved(i)));
    await yieldToLoop();
  },
  "delete+gc": async (i) => {
    deleteParts(buildEnclosure(moved(i)));
    await yieldToLoop();
    globalThis.gc();
    await yieldToLoop();
  },
  "recycle": async (i) => {
    buildEnclosure(moved(i));
    if (i % 100 === 99) {
      const start = performance.now();
      oc = await init();
      recycleMs.push(performance.now() - start);
    }
    await yieldToLoop();
  },
};

const recycleMs = [];
const mode = process.argv[2];
const rounds = Number(process.argv[3] ?? 300);
const body = strategies[mode];
const trace = [];
const t0 = performance.now();
for (let i = 0; i < rounds; i++) {
  await body(i);
  if (i % 100 === 99) trace.push(heapMB());
}
console.log(mode, {
  heapMBEvery100: trace,
  msPerRebuild: Math.round((performance.now() - t0) / rounds),
  ...(recycleMs.length ? { recycleMs: recycleMs.map(Math.round) } : {}),
});
