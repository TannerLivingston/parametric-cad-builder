import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { derive, referenceConfig } from "./enclosure.js";

const RESTART_ABOVE_MB = 1000;
const MOVED_BUTTON = "arcade-62-50";
const statusEl = document.querySelector("#status");
const slider = document.querySelector("#button-u");
const explode = document.querySelector("#explode");

// --- Engine: a Worker that is replaced when memory is high or it crashes
let worker;
let nextId = 0;
const pending = new Map();
let restarts = 0;

function startWorker() {
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data: { id, ok, result, error } }) => {
    const { resolve, reject } = pending.get(id);
    pending.delete(id);
    ok ? resolve(result) : reject(new Error(error));
  };
}

function call(type, args = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, ...args });
  });
}

// Guards against a boolean that never returns. The first build gets longer because
// uncached WASM runs slowly until it has been optimized.
const BUILD_BUDGET_MS = 5000;
const FIRST_BUILD_BUDGET_MS = 30000;
let overruns = 0;

async function callWithBudget(type, args, budgetMs = BUILD_BUDGET_MS) {
  const id = nextId;
  let timer;
  const overrun = new Promise((resolve) => {
    timer = setTimeout(() => resolve("overrun"), budgetMs);
  });
  const outcome = await Promise.race([call(type, args), overrun]);
  clearTimeout(timer);
  if (outcome !== "overrun") return outcome;
  overruns++;
  pending.delete(id);
  worker.terminate();
  startWorker();
  await call("init");
  restarts++;
  return call("build", { cfg });
}

let cfg = referenceConfig();

async function restartEngine() {
  const start = performance.now();
  worker.terminate();
  startWorker();
  await call("init");
  await rebuild();
  restarts++;
  return Math.round(performance.now() - start);
}

// --- Preview
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
camera.up.set(0, 0, 1);
camera.position.set(170, -420, 420);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
document.querySelector("#viewport").append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(152, 95, 25);
controls.update();
scene.background = new THREE.Color(0x20232a);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(100, -200, 400);
scene.add(sun);

const materials = {
  left: new THREE.MeshStandardMaterial({ color: 0x5b8def, roughness: 0.6, side: THREE.DoubleSide }),
  right: new THREE.MeshStandardMaterial({ color: 0xe9a23b, roughness: 0.6, side: THREE.DoubleSide }),
};
const meshes = {};
for (const side of ["left", "right"]) {
  meshes[side] = new THREE.Mesh(new THREE.BufferGeometry(), materials[side]);
  scene.add(meshes[side]);
}

function applyMesh(side, { vertices, normals, triangles }) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(triangles, 1));
  meshes[side].geometry.dispose();
  meshes[side].geometry = geometry;
}

function applyExplode() {
  const gap = Number(explode.value);
  meshes.left.position.x = -gap / 2;
  meshes.right.position.x = gap / 2;
  render();
}

function render() {
  renderer.render(scene, camera);
}

function resize() {
  const { clientWidth: w, clientHeight: h } = renderer.domElement.parentElement;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  render();
}
window.addEventListener("resize", resize);
controls.addEventListener("change", render);

const nextFrame = () => new Promise(requestAnimationFrame);

// --- Editing: moving a button re-cuts only the half that holds it
function withCutoutAt(id, u) {
  return { ...cfg, cutouts: cfg.cutouts.map((c) => (c.id === id ? { ...c, u } : c)) };
}

async function rebuild(budgetMs) {
  const result = await callWithBudget("build", { cfg }, budgetMs);
  for (const [side, mesh] of Object.entries(result.meshes)) applyMesh(side, mesh);
  render();
  return result;
}

async function moveCutout(id, side, u) {
  const start = performance.now();
  cfg = withCutoutAt(id, u);
  const result = await callWithBudget("recut", { cfg, side });
  for (const [part, mesh] of Object.entries(result.meshes)) applyMesh(part, mesh);
  render();
  const shownMs = performance.now() - start;
  statusEl.textContent = `Re-cut ${result.cutMs.toFixed(0)} ms, on screen ${shownMs.toFixed(0)} ms, heap ${result.heapMB} MB, restarts ${restarts}`;
  if (result.heapMB > RESTART_ABOVE_MB) await restartEngine();
  return { shownMs, cutMs: result.cutMs, heapMB: result.heapMB };
}

// Latest position wins, so dragging never queues up stale rebuilds.
let queued = null;
let busy = false;
async function pump() {
  if (busy) return;
  busy = true;
  while (queued !== null) {
    const u = queued;
    queued = null;
    await moveCutout(MOVED_BUTTON, "left", u);
  }
  busy = false;
}
slider.addEventListener("input", () => {
  queued = Number(slider.value);
  pump();
});
explode.addEventListener("input", applyExplode);

// --- Hooks the spike's measurements drive from the console
function summarise(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { runs: sorted.length, median: Math.round(sorted[sorted.length >> 1]), p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]), max: Math.round(sorted.at(-1)) };
}

window.spike = {
  bench: () => call("bench"),
  verify: () => call("verify"),
  view(x, y, z, gap = 0) {
    camera.position.set(x, y, z);
    controls.update();
    explode.value = gap;
    applyExplode();
  },
  async drag(steps = 60, id = MOVED_BUTTON, side = "left", centre = 62) {
    const shown = [];
    const cuts = [];
    const heap = [];
    const before = restarts;
    for (let i = 0; i < steps; i++) {
      const { shownMs, cutMs, heapMB } = await moveCutout(id, side, centre + Math.sin(i / 3) * 4);
      shown.push(shownMs);
      cuts.push(cutMs);
      heap.push(heapMB);
      await nextFrame();
    }
    return { shownMs: summarise(shown), cutMs: summarise(cuts), peakHeapMB: Math.max(...heap), restarts: restarts - before };
  },
  async soak(rebuilds = 300) {
    const before = restarts;
    let peak = 0;
    const restartMs = [];
    const shown = [];
    for (let i = 0; i < rebuilds; i++) {
      const start = performance.now();
      const result = await rebuild();
      shown.push(performance.now() - start);
      peak = Math.max(peak, result.heapMB);
      if (result.heapMB > RESTART_ABOVE_MB) restartMs.push(await restartEngine());
    }
    return { rebuilds, shownMs: summarise(shown), peakHeapMB: peak, restarts: restarts - before, overruns, restartMs: summarise(restartMs) };
  },
  async crashAndRecover() {
    let error = null;
    try {
      await call("crash");
    } catch (e) {
      error = e.message;
    }
    const restartMs = await restartEngine();
    const verified = await call("verify");
    return { error, restartMs, verified };
  },
};

// --- Start
async function main() {
  resize();
  const pageStart = performance.now();
  startWorker();
  const { initMs } = await call("init");
  const first = await rebuild(FIRST_BUILD_BUDGET_MS);
  applyExplode();
  const d = derive(cfg);
  window.spike.coldStart = { workerInitMs: initMs, firstBuildMs: Math.round(first.totalMs), toFirstPreviewMs: Math.round(performance.now() - pageStart) };
  statusEl.textContent = `Ready: ${cfg.cutouts.length} cutouts, ${cfg.tiltDeg}° panel, ${d.frontHeight.toFixed(1)} mm front height. First preview in ${window.spike.coldStart.toFirstPreviewMs} ms`;
  window.spike.ready = true;
}
main().catch((error) => {
  statusEl.textContent = `Failed to start: ${error.message}`;
});
