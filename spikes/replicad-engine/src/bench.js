// Timing suite shared by Node and the browser Worker.
import { buildEnclosure, cutoutsOnSide, recutHalf, referenceConfig } from "./enclosure.js";

const MESH_OPTIONS = { tolerance: 0.1, angularTolerance: 0.3 };

export function summarise(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { runs: sorted.length, median: Math.round(at(0.5)), p95: Math.round(at(0.95)), max: Math.round(sorted.at(-1)) };
}

function sample(runs, fn) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn(i);
    samples.push(performance.now() - start);
  }
  return summarise(samples);
}

function withMovedButton(cfg, i) {
  // Small enough to stay legal, varied so nothing can be served from a cache.
  return {
    ...cfg,
    cutouts: cfg.cutouts.map((c) => (c.id === "arcade-62-50" ? { ...c, u: c.u + ((i % 10) - 5) * 0.3 } : c)),
  };
}

function gridCutouts(count, cfg) {
  const cutouts = [];
  const columns = Math.ceil(Math.sqrt((count * cfg.width) / cfg.depth));
  const rows = Math.ceil(count / columns);
  const margin = 20;
  const seamGap = cfg.ribHalfThickness + 8;
  const usableU = cfg.width - 2 * margin;
  const usableV = cfg.depth - 2 * margin;
  for (let n = 0; n < count; n++) {
    const u = margin + ((n % columns) + 0.5) * (usableU / columns);
    const v = margin + (Math.floor(n / columns) + 0.5) * (usableV / rows);
    // Grids are nudged off the seam rather than being allowed to cross it.
    const clear = Math.abs(u - cfg.seamX) < seamGap ? cfg.seamX + Math.sign(u - cfg.seamX || 1) * seamGap : u;
    cutouts.push({ id: `grid-${n}`, kind: "circle", u: clear, v, diameter: Math.min(usableU / columns, usableV / rows) * 0.45 });
  }
  return cutouts;
}

export function runBench({ log = () => {}, runs = 30, heapBytes = () => null } = {}) {
  const cfg = referenceConfig();
  const results = {};

  log("full rebuild, batch cut");
  const stageTotals = {};
  results.fullRebuildBatch = sample(runs, (i) => {
    const { stages } = buildEnclosure(withMovedButton(cfg, i));
    for (const [name, ms] of Object.entries(stages)) (stageTotals[name] ??= []).push(ms);
  });
  results.stages = Object.fromEntries(Object.entries(stageTotals).map(([k, v]) => [k, summarise(v).median]));

  log("full rebuild, sequential cut");
  results.fullRebuildSequential = sample(Math.min(runs, 10), (i) => {
    buildEnclosure(withMovedButton(cfg, i), { strategy: "sequential" });
  });

  log("move one button, re-cut one half");
  const blanks = buildEnclosure(cfg);
  const leftCutouts = cutoutsOnSide(cfg, "left").length;
  const rightCutouts = cutoutsOnSide(cfg, "right").length;
  results.recutLeft = { cutouts: leftCutouts, ...sample(runs, (i) => recutHalf(blanks, withMovedButton(cfg, i), "left")) };
  results.recutRight = { cutouts: rightCutouts, ...sample(runs, (i) => recutHalf(blanks, withMovedButton(cfg, i), "right")) };

  log("mesh for preview");
  results.recutAndMeshLeft = sample(runs, (i) => {
    recutHalf(blanks, withMovedButton(cfg, i), "left").mesh(MESH_OPTIONS);
  });

  log("top edge fillet");
  results.fullRebuildWithTopFillet = sample(Math.min(runs, 10), (i) => {
    buildEnclosure({ ...withMovedButton(cfg, i), topEdgeFillet: 1.5 });
  });

  log("exports");
  results.exportSTL = sample(Math.min(runs, 10), () => {
    blanks.left.blobSTL({ binary: true, tolerance: 0.05, angularTolerance: 0.2 });
    blanks.right.blobSTL({ binary: true, tolerance: 0.05, angularTolerance: 0.2 });
  });
  results.exportSTEP = sample(Math.min(runs, 10), () => {
    blanks.left.blobSTEP();
    blanks.right.blobSTEP();
  });

  log("scaling with cutout count");
  results.scaling = {};
  for (const count of [10, 30, 60, 120, 240]) {
    const scaled = { ...cfg, cutouts: gridCutouts(count, cfg) };
    results.scaling[count] = sample(5, () => buildEnclosure(scaled)).median;
  }

  log("heap growth over repeated rebuilds");
  const heap = [];
  for (let i = 0; i < 200; i++) {
    const { left, right, leftBlank, rightBlank, base } = buildEnclosure(withMovedButton(cfg, i));
    left.mesh(MESH_OPTIONS);
    if (i % 50 === 49) heap.push({ rebuild: i + 1, heapMB: Math.round((heapBytes() ?? 0) / 1048576) });
    void right, leftBlank, rightBlank, base;
  }
  results.heap = heap;
  return results;
}
