// Spike geometry: a tilted wedge shell, split at a bolted seam, with panel
// cutouts applied per half. Runs unchanged in Node and in a Web Worker.
import { Plane, compoundShapes, draw, drawCircle, drawRoundedRectangle, makeCylinder } from "replicad";

const DEG = Math.PI / 180;
const OVERSHOOT = 0.5; // how far cut tools extend past the faces they cut

export const BOLT_DIAMETER = 3.4; // M3 clearance
export const PIN_DIAMETER = 4;
export const PIN_SOCKET_DIAMETER = 4.3;
export const pinLength = (cfg) => cfg.ribHalfThickness - 1.5; // keeps sockets blind

// Footprint and tilt come from the reference build. The placement of parts is a
// placeholder and the cutout sizes are illustrative, not measured.
export const referenceConfig = () => ({
  width: 304.8,
  depth: 190.5,
  rearHeight: 58,
  tiltDeg: 6,
  wall: 3,
  panelThickness: 3,
  cornerRadius: 6,
  seamX: 152.4,
  ribWidth: 9,
  ribHalfThickness: 5,
  cutouts: orcCutouts(),
});

export function orcCutouts() {
  const cutouts = [];
  // 8 arcade buttons, two rows of 4
  for (const v of [50, 86]) {
    for (const u of [30, 62, 94, 126]) {
      cutouts.push({ id: `arcade-${u}-${v}`, kind: "circle", u, v, diameter: 24.2 });
    }
  }
  // 3 latch buttons
  for (const u of [172, 198, 224]) {
    cutouts.push({ id: `latch-${u}`, kind: "circle", u, v: 118, diameter: 12.2 });
  }
  // 2 voicing pots
  for (const u of [254, 284]) {
    cutouts.push({ id: `pot-${u}`, kind: "circle", u, v: 118, diameter: 7.2 });
  }
  // 12 TTP223 pockets from below, leaving a thin skin to sense through
  for (let i = 0; i < 7; i++) {
    cutouts.push({ id: `natural-${i}`, kind: "pocket", u: 168 + 20 * i, v: 30, width: 16, height: 12, skin: 1 });
  }
  for (const i of [0, 1, 3, 4, 5]) {
    cutouts.push({ id: `sharp-${i}`, kind: "pocket", u: 178 + 20 * i, v: 52, width: 16, height: 12, skin: 1 });
  }
  // OLED window and its 4 mounting holes
  cutouts.push({ id: "oled-window", kind: "rect", u: 220, v: 155, width: 26, height: 15, radius: 1 });
  for (const [du, dv] of [[-11.75, -11.75], [11.75, -11.75], [-11.75, 11.75], [11.75, 11.75]]) {
    cutouts.push({ id: `oled-hole-${du}-${dv}`, kind: "circle", u: 220 + du, v: 155 + dv, diameter: 2.2 });
  }
  return cutouts;
}

// Derived dimensions. "z" below is measured on the outer top surface.
export function derive(cfg) {
  const tilt = cfg.tiltDeg * DEG;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const frontHeight = cfg.rearHeight - cfg.depth * Math.tan(tilt);
  return {
    cos,
    sin,
    frontHeight,
    topZ: (y) => frontHeight + y * Math.tan(tilt),
    verticalPanelThickness: cfg.panelThickness / cos,
    normal: [0, -sin, cos],
  };
}

function panelPlane(cfg, d, offset) {
  const origin = [0, d.normal[1] * offset, d.frontHeight + d.normal[2] * offset];
  return new Plane(origin, [1, 0, 0], d.normal);
}

function wedgePrism(y0, y1, zBottom, topZ, x0, x1) {
  return draw([y0, zBottom])
    .lineTo([y1, zBottom])
    .lineTo([y1, topZ(y1)])
    .lineTo([y0, topZ(y0)])
    .close()
    .sketchOnPlane("YZ", x0)
    .extrude(x1 - x0);
}

// Outer wedge minus inner wedge, plus a picture-frame rib straddling the seam.
export function buildBase(cfg) {
  const d = derive(cfg);
  const { width: W, depth: D, wall, ribWidth, ribHalfThickness: rib, seamX } = cfg;
  const innerTop = (y) => d.topZ(y) - d.verticalPanelThickness;

  let outer = wedgePrism(0, D, 0, d.topZ, 0, W).fillet(cfg.cornerRadius, (e) => e.inDirection("Z"));
  if (cfg.topEdgeFillet) {
    outer = outer.fillet(cfg.topEdgeFillet, (e) => e.inPlane(panelPlane(cfg, d, 0)));
  }
  const inner = wedgePrism(wall, D - wall, -1, innerTop, wall, W - wall).fillet(
    Math.max(cfg.cornerRadius - wall, 0.5),
    (e) => e.inDirection("Z"),
  );
  const shell = outer.cut(inner);

  // The frame reaches 0.5 into the walls and panel so the fuse is a clean overlap.
  const frameOuterTop = (y) => innerTop(y) + 0.5;
  const frameInnerTop = (y) => innerTop(y) - ribWidth / d.cos;
  const frameOuter = wedgePrism(wall - 0.5, D - wall + 0.5, 0, frameOuterTop, seamX - rib, seamX + rib);
  const frameInner = wedgePrism(wall + ribWidth, D - wall - ribWidth, -1, frameInnerTop, seamX - rib - 1, seamX + rib + 1);
  const frame = frameOuter.cut(frameInner);

  return shell.fuse(frame);
}

// Points on the seam rib, as [y, z]: three legs of the frame with two bolts each.
export function seamFasteners(cfg) {
  const d = derive(cfg);
  const { depth: D, wall, ribWidth } = cfg;
  const innerTop = (y) => d.topZ(y) - d.verticalPanelThickness;
  const frontY = wall + ribWidth / 2;
  const rearY = D - wall - ribWidth / 2;
  const underPanel = (y) => [y, innerTop(y) - ribWidth / 2];
  return {
    bolts: [
      [frontY, 10],
      [frontY, d.frontHeight - 16],
      [rearY, 10],
      [rearY, innerTop(rearY) - 12],
      underPanel(D * 0.35),
      underPanel(D * 0.65),
    ],
    pins: [
      [frontY, d.frontHeight / 2 - 3],
      [rearY, innerTop(rearY) / 2],
    ],
  };
}

function xCylinder(diameter, length, x, y, z) {
  return makeCylinder(diameter / 2, length, [x, y, z], [1, 0, 0]);
}

// Split at the seam, then add bolt holes, pins (left) and pin sockets (right).
export function splitAndJoin(base, cfg) {
  const { seamX, ribHalfThickness: rib } = cfg;
  const { positive, negative } = base.split("YZ", seamX);
  if (!positive || !negative) throw new Error("seam plane missed the shell");

  const { bolts, pins } = seamFasteners(cfg);
  const boltTools = bolts.map(([y, z]) => xCylinder(BOLT_DIAMETER, 2 * rib + 2, seamX - rib - 1, y, z));
  const boltTool = compoundShapes(boltTools);

  let left = negative.cut(boltTool);
  let right = positive.cut(boltTool);
  for (const [y, z] of pins) {
    left = left.fuse(xCylinder(PIN_DIAMETER, pinLength(cfg) + 1, seamX - 1, y, z));
    right = right.cut(xCylinder(PIN_SOCKET_DIAMETER, pinLength(cfg) + 1, seamX - 0.5, y, z));
  }
  return { left, right };
}

function cutoutTool(cut, cfg, d) {
  const t = cfg.panelThickness;
  const start = -(t + OVERSHOOT);
  const plane = panelPlane(cfg, d, start);
  let drawing;
  let length;
  if (cut.kind === "circle") {
    drawing = drawCircle(cut.diameter / 2);
    length = t + 2 * OVERSHOOT;
  } else if (cut.kind === "rect") {
    drawing = drawRoundedRectangle(cut.width, cut.height, cut.radius ?? 0);
    length = t + 2 * OVERSHOOT;
  } else if (cut.kind === "pocket") {
    drawing = drawRoundedRectangle(cut.width, cut.height, 1);
    length = t - cut.skin + OVERSHOOT;
  } else {
    throw new Error(`unknown cutout kind: ${cut.kind}`);
  }
  return drawing.translate(cut.u, cut.v).sketchOnPlane(plane).extrude(length);
}

// The volume a cutout should remove, for checking booleans against arithmetic.
export function cutoutVolume(cut, cfg) {
  const cornerLoss = (r) => (4 - Math.PI) * r * r;
  if (cut.kind === "circle") return (Math.PI * cut.diameter ** 2 * cfg.panelThickness) / 4;
  if (cut.kind === "rect") return (cut.width * cut.height - cornerLoss(cut.radius ?? 0)) * cfg.panelThickness;
  return (cut.width * cut.height - cornerLoss(1)) * (cfg.panelThickness - cut.skin);
}

export function cutoutsOnSide(cfg, side) {
  return cfg.cutouts.filter((c) => (side === "left" ? c.u < cfg.seamX : c.u >= cfg.seamX));
}

// "batch" cuts one compound of tools. "sequential" cuts one tool at a time.
export function applyCutouts(part, cutouts, cfg, strategy = "batch") {
  if (cutouts.length === 0) return part;
  const d = derive(cfg);
  const tools = cutouts.map((c) => cutoutTool(c, cfg, d));
  if (strategy === "sequential") {
    return tools.reduce((shape, tool) => shape.cut(tool, { simplify: false }), part);
  }
  return part.cut(compoundShapes(tools));
}

// A full rebuild with per-stage timing. `now` is injected so it works anywhere.
export function buildEnclosure(cfg, { strategy = "batch", now = () => performance.now() } = {}) {
  const stages = {};
  const timed = (name, fn) => {
    const start = now();
    const result = fn();
    stages[name] = now() - start;
    return result;
  };
  const base = timed("base", () => buildBase(cfg));
  const { left, right } = timed("splitAndJoin", () => splitAndJoin(base, cfg));
  const leftCut = timed("cutLeft", () => applyCutouts(left, cutoutsOnSide(cfg, "left"), cfg, strategy));
  const rightCut = timed("cutRight", () => applyCutouts(right, cutoutsOnSide(cfg, "right"), cfg, strategy));
  return { base, leftBlank: left, rightBlank: right, left: leftCut, right: rightCut, stages };
}

// Re-cuts only the half that changed, reusing the blanks from an earlier build.
export function recutHalf(blanks, cfg, side, strategy = "batch") {
  const blank = side === "left" ? blanks.leftBlank : blanks.rightBlank;
  return applyCutouts(blank, cutoutsOnSide(cfg, side), cfg, strategy);
}
