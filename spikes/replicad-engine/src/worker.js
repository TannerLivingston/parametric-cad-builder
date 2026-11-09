// Holds the WASM instance. The page restarts this Worker to reclaim memory.
import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { setOC } from "replicad";
import { runBench } from "./bench.js";
import { buildEnclosure, recutHalf, referenceConfig } from "./enclosure.js";
import { analyseMesh, brepIsValid, parseBinarySTL, sha256, stripStepTimestamp } from "./checks.js";

const MESH_OPTIONS = { tolerance: 0.1, angularTolerance: 0.3 };
const STL_OPTIONS = { binary: true, tolerance: 0.05, angularTolerance: 0.2 };
let oc;
let built;
let current = {};

const heapMB = () => Math.round(oc.wasmMemory.buffer.byteLength / 1048576);

function packMesh(part) {
  const mesh = part.mesh(MESH_OPTIONS);
  return {
    vertices: Float32Array.from(mesh.vertices),
    normals: Float32Array.from(mesh.normals),
    triangles: Uint32Array.from(mesh.triangles),
  };
}

const transferables = (meshes) => Object.values(meshes).flatMap((m) => [m.vertices.buffer, m.normals.buffer, m.triangles.buffer]);

const handlers = {
  async init() {
    const start = performance.now();
    oc = await opencascade({ locateFile: () => wasmUrl, print() {}, printErr() {} });
    setOC(oc);
    return { initMs: Math.round(performance.now() - start) };
  },

  build({ cfg }) {
    const start = performance.now();
    built = buildEnclosure(cfg);
    current = { left: built.left, right: built.right };
    const buildMs = performance.now() - start;
    const meshes = { left: packMesh(current.left), right: packMesh(current.right) };
    return { result: { meshes, buildMs, totalMs: performance.now() - start, heapMB: heapMB() }, transfer: transferables(meshes) };
  },

  recut({ cfg, side }) {
    const start = performance.now();
    current[side] = recutHalf(built, cfg, side);
    const cutMs = performance.now() - start;
    const meshes = { [side]: packMesh(current[side]) };
    return { result: { meshes, cutMs, totalMs: performance.now() - start, heapMB: heapMB() }, transfer: transferables(meshes) };
  },

  bench() {
    return runBench({ heapBytes: () => oc.wasmMemory.buffer.byteLength });
  },

  async verify() {
    const report = {};
    for (const side of ["left", "right"]) {
      const part = buildEnclosure(referenceConfig())[side];
      const stl = new Uint8Array(await part.blobSTL(STL_OPTIONS).arrayBuffer());
      const step = await part.blobSTEP().text();
      const mesh = analyseMesh(parseBinarySTL(stl));
      report[side] = {
        valid: brepIsValid(part),
        watertight: mesh.watertight,
        stlSha: await sha256(stl),
        stepSha: await sha256(stripStepTimestamp(step)),
      };
    }
    return report;
  },

  crash() {
    const button = { kind: "circle", u: 60, v: 60, diameter: 24 };
    return buildEnclosure({ ...referenceConfig(), cutouts: [{ id: "a", ...button }, { id: "b", ...button, u: 70 }] }).stages;
  },
};

self.onmessage = async ({ data: { id, type, ...args } }) => {
  try {
    const output = await handlers[type](args);
    const { result, transfer } = output?.transfer ? output : { result: output, transfer: [] };
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message ?? error) });
  }
};
