# Replicad engine spike

**Question:** is Replicad (OpenCascade compiled to WASM) fast and reliable enough to be the
browser-only engine for the enclosure generator?

**Answer: yes, with four conditions** (see [What the real engine must do](#what-the-real-engine-must-do)).

The model is a 304.8 x 190.5 mm wedge shell with a 6° panel and 30 cutouts, split at a bolted
seam with alignment pins so each half fits the 256 mm build volume. The footprint and tilt come
from the Desk Synth. The part placement is a placeholder and the cutout sizes are unmeasured.

## Results

Apple M4 Pro, Node 22 and the Chromium in the Claude desktop app. Medians unless noted.

| Operation | Browser Worker | Node |
| --- | --- | --- |
| Move a part in the 8-cutout half, on screen | 41 ms | |
| Move a part in the 22-cutout half, on screen | 144 ms | |
| Full rebuild and mesh of both halves, on screen | 273 ms | |
| Full rebuild, no meshing | 241 ms* | 279 ms |
| Full rebuild with a top edge fillet | 288 ms* | 326 ms |
| Full rebuild cutting one tool at a time | 545 ms* | 624 ms |
| Export both halves, STL | 76 ms* | 82 ms |
| Export both halves, STEP | 25 ms* | 26 ms |
| Engine restart, including a rebuild | about 0.5 s | |

\* Measured before the seam rib went from 8 to 10 mm thick. The change barely moved the Node numbers.

Full rebuild against cutout count, in the browser: 10 → 131 ms, 30 → 193 ms, 60 → 291 ms,
120 → 487 ms, 240 → 891 ms. Growth is close to linear.

**First load:** about 0.5 s to the first preview once the browser has cached the compiled WASM.
With nothing cached it took 3.6 s, and 8.5 s while Node was also running. All of this was on
localhost, so a real first visit also downloads the 7.2 MB (gzipped) WASM file.

## Reliability

- **500 random valid layouts:** no failures. Each was checked for a valid B-rep, a watertight
  STL, and cut volume within 1% of the arithmetic. 260 had top edge fillets. Builds: median
  334 ms, max 615 ms.
- **Exports are reproducible:** the same config gave identical STL and STEP hashes across builds,
  after heavy use, and between Node and the browser. STEP needs its timestamp and a product name
  counter stripped first (`stripStepTimestamp`).
- **STEP round trip:** re-importing gives the same volume to the nearest cubic millimetre, through
  OpenCascade and through Fusion (see [Fusion import](#fusion-import)).
- **The joint:** the halves don't collide (shifting one by 1 mm does overlap, as a control), the
  rib adds material, and the sockets are blind. These checks ran in OpenCascade.

## Fusion import

Tested in Fusion 2705.1.30 through its local MCP server.

| Check | Left | Right |
| --- | --- | --- |
| Solid bodies | 1 | 1 |
| Volume, Fusion / engine (mm³) | 153,381.2 / 153,381 | 157,119.3 / 157,119 |
| Size (mm) | 155.9 x 190.5 x 58 | 152.4 x 190.5 x 58 |
| Faces | 20 cylinders, 16 planes | 73 cylinders, 80 planes |
| Spline faces | 0 | 0 |

Each file imported in under 0.3 s. The holes, seam rib, bolt holes and pockets look correct in
Fusion's viewport.

**The imported bodies are editable.** These ran as timeline features on the imported left half:

| Edit | Result | Expected |
| --- | --- | --- |
| Fillet a button hole edge, 1 mm | removed 16.6 mm³ | about 16.6 mm³ |
| Sketch on the tilted panel, cut a 10 mm hole | removed 235.62 mm³ | 235.62 mm³ |
| Offset a hole face by 0.5 mm (shrinks the hole) | added 111.68 mm³ | 111.68 mm³ |
| Move the whole body 3 mm | worked | |

The timeline stayed healthy, and the body stayed one solid.

**Collisions:** Fusion's kernel found 0 mm³ of overlap between the halves, and 2,516 mm³ with one
shifted 1 mm as a control. `analyzeInterference` reported none in both cases, so it wasn't used.

**Moving a single hole face through the API fails** with `featVec.size() > 0`. It fails the same way
on a block built entirely in Fusion, so the STEP files aren't the cause. Moving a face by hand in
Fusion's UI hasn't been tried.

**One crash, cause unknown.** An early script that combined many of these steps crashed Fusion
before returning output. The kernel booleans and edits later passed when run one at a time. That
script also switched a document to direct modelling and moved an occurrence, and neither was repeated.

Rules for scripting Fusion: use a new document, keep no other document open with unsaved work, run
one risky step per script, and log progress to a file so a crash shows the last step reached.
Sketches on a face also project the face's edges, so select profiles by area, not by index.

## Problems found

### Memory grows about 8 MB per full rebuild

WASM memory never comes back, even with every shape deleted, the boolean builder deleted and
garbage collection forced. Any boolean retains some (`scripts/leak-probe.mjs`), so it isn't only
the Replicad wrappers. The root cause wasn't found. It could reach the 4 GB WASM limit in roughly
500 rebuilds.

Restarting the Worker fixes it. A 300-rebuild soak test peaked at 1,079 MB with three restarts,
at the 1,000 MB threshold, or about one 0.5 s pause per 100 full rebuilds.

### Some invalid layouts fail badly

| Layout | Result |
| --- | --- |
| Two cutouts overlapping | **WASM crash**, `memory access out of bounds`, when cutting as a batch. Cutting one at a time is fine |
| Two cutouts exactly tangent | **Non-manifold edge**, with no error |
| Cutout crossing the seam | **Only cut on one half**, with no error |
| Cutout overlapping the seam rib | Cuts through the rib, with no error |
| Cutout off or past the panel edge | Partial or no cut, with no error |

After the crash, a fresh Worker gave byte-identical exports.

## What the real engine must do

1. **Run validation before any geometry.** It must reject overlaps, near-tangent spacing, seam and
   rib conflicts, and off-panel parts. The engine can't be relied on to report these itself.
2. **Run in a Worker that can be replaced.** Restart it above a heap threshold, on any exception,
   and when a build overruns its time limit. After an exception, treat the instance as corrupted.
3. **Cut per half, and cache the uncut blanks.** Moving a part then re-cuts one half. Batching tools
   is about 2x faster than one at a time, and it needs the overlap check in rule 1.
4. **Split parts by seam at the schema level.** Each cutout belongs to one printed part, which is
   what makes the per-part caching possible.

## Not tested

- Printing anything.
- Moving a single face by hand in Fusion's UI.
- Firefox, Safari, or lower-powered machines. Everything ran on one M4 Pro.
- The bottom plate, standoffs, and lid fastening.
- Fillets on the cutouts themselves, the case most likely to be fragile in OpenCascade.
- The watchdog against a real hung boolean, because none occurred. It fired once on an uncached
  first build under load and recovered, so the first build now gets a longer limit.

## A false alarm worth knowing about

Long runs appeared to stall for about 1,000 seconds at a time. It was the Mac sleeping overnight:
`pmset -g log` shows the same cycle. Long benchmarks should run under `caffeinate`, and any
surprising timing should be checked against the power log first.

## Licensing

`replicad` is MIT. `replicad-opencascadejs` is LGPL-2.1. Serving its WASM unmodified from a public
site should be straightforward, but check the obligations before release.

## Running it

```bash
npm install
```

```bash
npm run smoke   # one build, all checks, writes STL and STEP to output/
```

```bash
npm run bench   # timings and reproducibility
```

```bash
npm run fuzz    # 200 random layouts, plus the invalid cases; pass -- 500 for more
```

```bash
npm run preview:spike   # the live preview, on port 4173
```

In the page, `window.spike` exposes `drag()`, `soak()`, `bench()`, `verify()` and `crashAndRecover()`.
