// Seeded random layouts, shared by the fuzz run and the single-seed probe.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function radiusOf(c) {
  return c.kind === "circle" ? c.diameter / 2 : Math.hypot(c.width, c.height) / 2;
}

function randomCutout(random, id, cfg, panelLength) {
  const between = (a, b) => a + random() * (b - a);
  const roll = random();
  let shape;
  if (roll < 0.5) shape = { kind: "circle", diameter: between(2, 30) };
  else if (roll < 0.75) shape = { kind: "rect", width: between(5, 40), height: between(5, 30), radius: between(0.5, 2) };
  else shape = { kind: "pocket", width: between(6, 25), height: between(6, 25), skin: between(0.6, cfg.panelThickness - 0.6) };
  return { id, ...shape, u: between(0, cfg.width), v: between(0, panelLength) };
}

// Rejection-samples a legal layout, the same way a validator would filter one.
export function randomConfig(seed) {
  const random = rng(seed);
  const between = (a, b) => a + random() * (b - a);
  const depth = between(120, 240);
  const rearHeight = between(45, 90);
  const maxTilt = (Math.atan((rearHeight - 38) / depth) * 180) / Math.PI;
  const wall = between(2, 4);
  const cfg = {
    width: between(200, 420),
    depth,
    rearHeight,
    tiltDeg: between(0, Math.min(maxTilt, 15)),
    wall,
    panelThickness: between(2, 4),
    cornerRadius: between(wall + 1, 12),
    ribWidth: between(7, 10),
    ribHalfThickness: between(4, 6),
    topEdgeFillet: random() < 0.5 ? between(0.5, 2) : 0,
  };
  cfg.seamX = cfg.width * between(0.4, 0.6);
  const panelLength = depth / Math.cos((cfg.tiltDeg * Math.PI) / 180);
  const margin = cfg.wall + cfg.cornerRadius + 3;
  const seamKeepOut = cfg.ribHalfThickness + 2;

  const wanted = 20 + Math.floor(random() * 25);
  const cutouts = [];
  for (let attempt = 0; attempt < 2000 && cutouts.length < wanted; attempt++) {
    const c = randomCutout(random, `c${attempt}`, cfg, panelLength);
    const r = radiusOf(c);
    const inside = c.u - r > margin && c.u + r < cfg.width - margin && c.v - r > margin && c.v + r < panelLength - margin;
    const clearOfSeam = Math.abs(c.u - cfg.seamX) > r + seamKeepOut;
    const clearOfOthers = cutouts.every((o) => Math.hypot(o.u - c.u, o.v - c.v) > r + radiusOf(o) + 0.8);
    if (inside && clearOfSeam && clearOfOthers) cutouts.push(c);
  }
  return { ...cfg, cutouts };
}
