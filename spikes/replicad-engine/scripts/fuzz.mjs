// Seeded random layouts plus awkward cases, run the way the app runs the engine:
// in a worker that is killed and replaced if a build overruns, crashes, or the
// heap gets large. Usage: fuzz.mjs [count] [firstSeed]
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import opencascade from "replicad-opencascadejs";
import { measureVolume, setOC } from "replicad";
import { applyCutouts, buildBase, cutoutVolume, cutoutsOnSide, referenceConfig, splitAndJoin } from "../src/enclosure.js";
import { analyseMesh, brepIsValid, parseBinarySTL } from "../src/checks.js";
import { randomConfig } from "./fuzz-config.mjs";

const BUDGET_MS = 5000;
const RESTART_ABOVE_MB = 1000;

if (!isMainThread) {
  const oc = await opencascade({ print() {}, printErr() {} });
  setOC(oc);
  parentPort.on("message", async ({ id, cfg }) => {
    const stage = (name) => parentPort.postMessage({ id, stage: name });
    try {
      const start = performance.now();
      stage("base");
      const base = buildBase(cfg);
      stage("splitAndJoin");
      const blanks = splitAndJoin(base, cfg);
      const parts = {};
      for (const side of ["left", "right"]) {
        stage(`cut ${side}`);
        parts[side] = applyCutouts(blanks[side], cutoutsOnSide(cfg, side), cfg);
      }
      const buildMs = performance.now() - start;

      const problems = [];
      for (const side of ["left", "right"]) {
        const part = parts[side];
        stage(`check ${side}`);
        if (!brepIsValid(part)) problems.push(`${side}: invalid B-rep`);
        const stl = await part.blobSTL({ binary: true, tolerance: 0.1, angularTolerance: 0.3 }).arrayBuffer();
        const mesh = analyseMesh(parseBinarySTL(new Uint8Array(stl)));
        if (!mesh.watertight) problems.push(`${side}: mesh has ${mesh.openEdges} open and ${mesh.nonManifoldEdges} non-manifold edges`);
        const removed = measureVolume(blanks[side]) - measureVolume(part);
        const expected = cutoutsOnSide(cfg, side).reduce((sum, c) => sum + cutoutVolume(c, cfg), 0);
        if (expected > 0 && Math.abs(removed - expected) / expected > 0.01) {
          problems.push(`${side}: removed ${removed.toFixed(1)} mm3, expected ${expected.toFixed(1)}`);
        }
      }
      parentPort.postMessage({ id, done: true, problems, buildMs, heapMB: oc.wasmMemory.buffer.byteLength / 1048576 });
    } catch (error) {
      parentPort.postMessage({ id, done: true, threw: String(error?.message ?? error) });
    }
  });
} else {
  let worker;
  let nextId = 0;
  let restarts = 0;
  const startWorker = () => {
    worker = new Worker(fileURLToPath(import.meta.url));
  };
  const restart = async () => {
    await worker.terminate();
    startWorker();
    restarts++;
  };

  // Resolves with the worker's report, or with the stage it was in when it overran.
  const attempt = (cfg) =>
    new Promise((resolve) => {
      const id = nextId++;
      let stage = "starting";
      const started = performance.now();
      const finish = (result) => {
        clearTimeout(timer);
        worker.off("message", onMessage);
        worker.off("error", onError);
        resolve(result);
      };
      const onMessage = (message) => {
        if (message.id !== id) return;
        if (message.done) finish(message);
        else stage = message.stage;
      };
      const onError = (error) => finish({ threw: `worker died: ${error.message}` });
      const timer = setTimeout(() => finish({ overran: true, stage, afterMs: Math.round(performance.now() - started) }), BUDGET_MS);
      worker.on("message", onMessage);
      worker.on("error", onError);
      worker.postMessage({ id, cfg });
    });

  // One retry on a fresh engine, as the app would do before showing an error.
  async function run(cfg) {
    const first = await attempt(cfg);
    if (first.overran || first.threw) await restart();
    else if (first.heapMB > RESTART_ABOVE_MB) await restart();
    if (!first.overran) return { ...first, stalls: [] };
    const second = await attempt(cfg);
    if (second.overran || second.threw) await restart();
    return { ...second, stalls: second.overran ? [first, second] : [first], retried: true };
  }

  startWorker();
  const count = Number(process.argv[2] ?? 200);
  const firstSeed = Number(process.argv[3] ?? 1);
  const failures = [];
  const stalls = [];
  const times = [];
  let filleted = 0;
  const started = performance.now();
  for (let seed = firstSeed; seed < firstSeed + count; seed++) {
    const cfg = randomConfig(seed);
    if (cfg.topEdgeFillet) filleted++;
    const result = await run(cfg);
    for (const s of result.stalls) stalls.push({ seed, stage: s.stage, retryBuildMs: Math.round(result.buildMs ?? -1) });
    if (result.buildMs) times.push(result.buildMs);
    if (result.overran || result.threw || result.problems?.length) {
      failures.push({ seed, cutouts: cfg.cutouts.length, overran: result.overran, threw: result.threw, problems: result.problems });
    }
    if (seed % 50 === 0) process.stderr.write(`seed ${seed}, ${stalls.length} stalls, ${failures.length} failures, ${Math.round((performance.now() - started) / 1000)} s\n`);
  }
  times.sort((a, b) => a - b);
  console.log(JSON.stringify({
    configs: count,
    withTopFillet: filleted,
    failures: failures.length,
    failureDetail: failures.slice(0, 20),
    stalls: stalls.length,
    stallDetail: stalls.slice(0, 30),
    restarts,
    buildMs: { median: Math.round(times[times.length >> 1]), p99: Math.round(times[Math.floor(times.length * 0.99)]), max: Math.round(times.at(-1)) },
    seconds: Math.round((performance.now() - started) / 1000),
  }, null, 2));

  // Layouts a validator should reject. What matters is how the engine fails if one
  // slips through: an exception is fine, silently wrong geometry is not.
  const ref = referenceConfig();
  const button = { kind: "circle", u: 60, v: 60, diameter: 24 };
  const awkward = {
    "tilt of zero": { ...ref, tiltDeg: 0 },
    "two cutouts overlapping": { ...ref, cutouts: [{ id: "a", ...button }, { id: "b", ...button, u: 70 }] },
    "two identical cutouts": { ...ref, cutouts: [{ id: "a", ...button }, { id: "b", ...button }] },
    "two cutouts exactly tangent": { ...ref, cutouts: [{ id: "a", ...button }, { id: "b", ...button, u: 84 }] },
    "cutout crossing the seam": { ...ref, cutouts: [{ id: "a", ...button, u: ref.seamX }] },
    "cutout into the seam rib": { ...ref, cutouts: [{ id: "a", ...button, u: ref.seamX - 14 }] },
    "cutout hanging off the edge": { ...ref, cutouts: [{ id: "a", ...button, u: 5 }] },
    "cutout entirely off the panel": { ...ref, cutouts: [{ id: "a", ...button, u: -100 }] },
    "cutout tangent to inner wall": { ...ref, cutouts: [{ id: "a", ...button, u: ref.wall + 12 }] },
    "corner radius below wall": { ...ref, cornerRadius: 1 },
    "no cutouts": { ...ref, cutouts: [] },
  };
  const report = {};
  for (const [name, cfg] of Object.entries(awkward)) {
    const result = await run(cfg);
    report[name] = result.overran ? `overran in ${result.stage}` : result.threw ? `threw: ${result.threw}` : result.problems.length ? result.problems : "ok";
  }
  console.log(JSON.stringify(report, null, 2));
  await worker.terminate();
}
