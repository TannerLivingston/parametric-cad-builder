// Runs the engine off the main thread. Holding the WASM instance here means the page can
// throw the whole thing away to reclaim memory, or after a crash.
import { withoutCurveCreases } from "./curveEdges.js";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { importSTEP, type Shape3D } from "replicad";
import { buildEnclosure, initEngine, labelInlays, placedOnBed, recutPart, type Enclosure } from "../engine.js";
import { orientationsFor, planPartPrint, printGuide, resolvedFor, type PartPrintReport } from "../printing.js";
import { writeZip, type ZipFile } from "../zip.js";
import { bedFiles } from "../threeMF.js";
import type { FitTestPlan } from "../fitTest.js";
import { buildFitTest, type FitTestPart } from "../fitTestBuild.js";
import type { BuildPlan } from "../validate.js";
import { partsToRecut, planKeys, type PlanKeys } from "./planDiff.js";

export type PartKind = "shell" | "top" | "plate" | "rail" | "knob";

export interface PartMesh {
  index: number;
  vertices: Float32Array;
  normals: Float32Array;
  triangles: Uint32Array;
  edges: Float32Array;
}

export type EngineRequest =
  | { id: number; type: "init" }
  | { id: number; type: "build"; plan: BuildPlan }
  | { id: number; type: "export"; plan: BuildPlan; index: number; format: "stl" | "step" }
  | { id: number; type: "print"; plan: BuildPlan }
  | { id: number; type: "bedView"; plan: BuildPlan; index: number }
  | { id: number; type: "bundle"; plan: BuildPlan; only?: string[] }
  | { id: number; type: "fitTest"; plan: FitTestPlan }
  | { id: number; type: "exportFitTest"; plan: FitTestPlan; index: number; format: "stl" | "step" }
  | { id: number; type: "reference"; bytes: ArrayBuffer };

// A part's own model, read from its STEP file. See reference.ts.
export interface ReferenceMesh extends PartMesh {
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

export interface FitTestMesh extends PartMesh {
  name: string;
}

export interface BedView extends PartMesh {
  gaps: [number, number, number][];
  bed: { x: number; y: number; z: number };
}

export interface BuildResult {
  meshes: PartMesh[];
  partCount: number;
  partKinds: PartKind[];
  partColors: string[];
  rebuilt: "all" | number[];
  buildMs: number;
  heapMB: number;
}

const MESH_OPTIONS = { tolerance: 0.1, angularTolerance: 0.3 };
const EXPORT_OPTIONS = { binary: true, tolerance: 0.05, angularTolerance: 0.2 };

let oc: { wasmMemory: WebAssembly.Memory } | undefined;
let enclosure: Enclosure | undefined;
let keys: PlanKeys | null = null;
// Kept until the part changes, so that moving one button only looks at one part again.
const printReports = new Map<number, PartPrintReport>();

function printReportsFor(plan: BuildPlan): PartPrintReport[] {
  return plan.printedParts.map((part) => {
    const known = printReports.get(part.index);
    if (known) return known;
    const shape = enclosure!.parts[part.index]!.shape;
    const report = planPartPrint(part, shape.mesh(MESH_OPTIONS), orientationsFor(plan, part), plan.config.fabrication.buildVolume, resolvedFor(plan, part));
    printReports.set(part.index, report);
    return report;
  });
}

function onBed(plan: BuildPlan, index: number) {
  const { best } = printReportsFor(plan)[index]!;
  return placedOnBed(enclosure!.parts[index]!.shape, best.matrix, best.offset);
}

// What fills a part's inlaid labels, placed with it on the bed.
function inlaysOnBed(plan: BuildPlan, index: number) {
  const { best } = printReportsFor(plan)[index]!;
  return labelInlays(plan, index, enclosure!.parts[index]!.blank).map((inlay) => ({ color: inlay.color, shape: placedOnBed(inlay.shape, best.matrix, best.offset) }));
}
let fitTest: { key: string; shapes: Shape3D[] | undefined; parts: FitTestPart[] } | null = null;

function fitTestParts(plan: FitTestPlan): FitTestPart[] {
  const key = JSON.stringify(plan);
  // What's cut from the real shell goes out of date with it.
  const shapes = enclosure?.parts.map((part) => part.shape);
  const same = fitTest?.shapes?.length === shapes?.length && (shapes ?? []).every((shape, i) => shape === fitTest!.shapes![i]);
  if (fitTest?.key !== key || !same) fitTest = { key, shapes, parts: buildFitTest(plan, shapes) };
  return fitTest.parts;
}

function packMesh(index: number, shape: Shape3D): PartMesh {
  const mesh = shape.mesh(MESH_OPTIONS);
  const edges = shape.meshEdges(MESH_OPTIONS);
  return {
    index,
    vertices: Float32Array.from(mesh.vertices),
    normals: Float32Array.from(mesh.normals),
    triangles: Uint32Array.from(mesh.triangles),
    edges: Float32Array.from(edges.lines),
  };
}

function build(plan: BuildPlan): { result: BuildResult; transfer: ArrayBuffer[] } {
  const start = performance.now();
  const next = planKeys(plan);
  const recut = enclosure ? partsToRecut(keys, next) : null;
  if (recut && enclosure) {
    for (const index of recut) {
      recutPart(enclosure, plan, index);
      printReports.delete(index);
    }
  } else {
    enclosure = buildEnclosure(plan);
    printReports.clear();
  }
  keys = next;
  const changed = recut ? enclosure.parts.filter((p) => recut.includes(p.index)) : enclosure.parts;
  const meshes = changed.map((part) => {
    const mesh = packMesh(part.index, part.shape);
    return part.kind === "shell" ? { ...mesh, edges: withoutCurveCreases(mesh.edges, plan.profile.surfaces) } : mesh;
  });
  return {
    result: {
      meshes,
      partCount: enclosure.parts.length,
      partKinds: enclosure.parts.map((p) => p.kind),
      partColors: enclosure.parts.map((p) => p.color),
      rebuilt: recut ?? "all",
      buildMs: performance.now() - start,
      heapMB: Math.round(oc!.wasmMemory.buffer.byteLength / 1048576),
    },
    transfer: meshes.flatMap((m) => [m.vertices.buffer, m.normals.buffer, m.triangles.buffer, m.edges.buffer]) as ArrayBuffer[],
  };
}

async function handle(message: EngineRequest): Promise<{ result: unknown; transfer: ArrayBuffer[] }> {
  if (message.type === "init") {
    const start = performance.now();
    oc = (await initEngine({ locateFile: () => wasmUrl })) as unknown as { wasmMemory: WebAssembly.Memory };
    return { result: { initMs: performance.now() - start }, transfer: [] };
  }
  if (message.type === "build") return build(message.plan);
  if (message.type === "print") return { result: printReportsFor(message.plan), transfer: [] };
  if (message.type === "bedView") {
    const report = printReportsFor(message.plan)[message.index]!;
    const mesh = packMesh(message.index, onBed(message.plan, message.index));
    const { matrix: m, offset } = report.best;
    const printed = (p: readonly number[]) => [m[0] * p[0]! + m[1] * p[1]! + m[2] * p[2]! + offset[0], m[3] * p[0]! + m[4] * p[1]! + m[5] * p[2]! + offset[1], m[6] * p[0]! + m[7] * p[1]! + m[8] * p[2]! + offset[2]] as [number, number, number];
    const gaps = report.gaps.map((gap) => printed(gap.min.map((value, axis) => (value + gap.max[axis]!) / 2)));
    return { result: { ...mesh, gaps, bed: message.plan.config.fabrication.buildVolume }, transfer: [mesh.vertices.buffer, mesh.normals.buffer, mesh.triangles.buffer, mesh.edges.buffer] as ArrayBuffer[] };
  }
  if (message.type === "bundle") {
    const reports = printReportsFor(message.plan);
    const encoder = new TextEncoder();
    const files: ZipFile[] = [{ name: "how-to-print.txt", bytes: encoder.encode(printGuide(message.plan, reports)) }];
    const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    for (const report of reports) {
      if (message.only && !message.only.includes(report.name)) continue;
      const bytes = await onBed(message.plan, report.index).blobSTL(EXPORT_OPTIONS).arrayBuffer();
      files.push({ name: `${slug(report.name)}.stl`, bytes: new Uint8Array(bytes) });
      for (const inlay of inlaysOnBed(message.plan, report.index)) {
        files.push({ name: `${slug(report.name)}-labels-${slug(inlay.color)}.stl`, bytes: new Uint8Array(await inlay.shape.blobSTL(EXPORT_OPTIONS).arrayBuffer()) });
      }
    }
    if (!message.only) files.push(...bedFiles(message.plan, reports, (index) => onBed(message.plan, index).mesh(EXPORT_OPTIONS), (index) => inlaysOnBed(message.plan, index).map((inlay) => ({ color: inlay.color, mesh: inlay.shape.mesh(EXPORT_OPTIONS) }))));
    const zip = writeZip(files);
    return { result: zip.buffer, transfer: [zip.buffer as ArrayBuffer] };
  }
  if (message.type === "fitTest") {
    const meshes: FitTestMesh[] = fitTestParts(message.plan).map((part, index) => ({ ...packMesh(index, part.shape), name: part.name }));
    return { result: meshes, transfer: meshes.flatMap((m) => [m.vertices.buffer, m.normals.buffer, m.triangles.buffer, m.edges.buffer]) as ArrayBuffer[] };
  }
  if (message.type === "reference") {
    const shape = (await importSTEP(new Blob([message.bytes]))) as Shape3D;
    const mesh = packMesh(-1, shape);
    if (mesh.triangles.length === 0) throw new Error("That file has no solid in it to show.");
    const [min, max] = shape.boundingBox.bounds as [[number, number, number], [number, number, number]];
    shape.delete();
    return { result: { ...mesh, bounds: { min, max } }, transfer: [mesh.vertices.buffer, mesh.normals.buffer, mesh.triangles.buffer, mesh.edges.buffer] as ArrayBuffer[] };
  }
  if (message.type === "exportFitTest") {
    const shape = fitTestParts(message.plan)[message.index]?.shape;
    if (!shape) throw new Error(`There is no fit test part ${message.index} to export.`);
    const bytes = await (message.format === "stl" ? shape.blobSTL(EXPORT_OPTIONS) : shape.blobSTEP()).arrayBuffer();
    return { result: bytes, transfer: [bytes] };
  }

  if (!enclosure?.parts[message.index]) throw new Error(`There is no printed part ${message.index} to export.`);
  const placed = onBed(message.plan, message.index);
  const blob = message.format === "stl" ? placed.blobSTL(EXPORT_OPTIONS) : placed.blobSTEP();
  const bytes = await blob.arrayBuffer();
  return { result: bytes, transfer: [bytes] };
}

self.onmessage = async ({ data }: MessageEvent<EngineRequest>) => {
  try {
    const { result, transfer } = await handle(data);
    (self as unknown as Worker).postMessage({ id: data.id, ok: true, result }, transfer);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id: data.id, ok: false, error: String((error as Error)?.message ?? error) });
  }
};
