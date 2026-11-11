// What's at a click in the view, as its path in the config: a label, a hole or vent in a wall, a
// seam, something on the plate, or failing those the surface or wall itself. Parts aren't here,
// since they have markers of their own to click.
import { textOutline } from "../lettering.js";
import type { RawConfig } from "./configEdit.js";
import type { Spot } from "./pickSpot.js";

const AROUND = 1.5; // how far outside something a click still counts as on it
const SEAM_REACH = 2; // either side of a seam's line
export const WALLS_PATH = "enclosure.wall"; // what a click on a bare wall selects: the walls' own settings

const within = (a: number, b: number, half: number) => Math.abs(a - b) <= half + AROUND;
const list = (value: unknown): RawConfig[] => (Array.isArray(value) ? value : []);
function firstIndex(items: RawConfig[], test: (item: RawConfig) => boolean, path: string): string | null {
  const index = items.findIndex(test);
  return index === -1 ? null : `${path}[${index}]`;
}

// A label's size as it sits, so turned if it's turned.
function labelSize(label: RawConfig): [number, number] {
  const outline = textOutline(String(label.text ?? ""), Number(label.size ?? 5));
  return label.rotationDeg === 90 || label.rotationDeg === 270 ? [outline.height, outline.width] : [outline.width, outline.height];
}

// Something in particular at a spot, or null where there's only the surface, wall or plate.
function itemAt(config: RawConfig, spot: Spot): string | null {
  const labels = list(config.labels);
  const seams = list(config.seams);
  const plate: RawConfig = config.plate ?? {};
  const seamAt = (x: number) => firstIndex(seams, (seam) => Math.abs(seam.x - x) <= SEAM_REACH, "seams");
  if (spot.kind === "surface") {
    const first = config.enclosure?.surfaces?.[0]?.id;
    const label = firstIndex(labels, (l) => {
      if (typeof l.u !== "number" || (l.surface ?? first) !== spot.surface) return false;
      const [across, up] = labelSize(l);
      return within(spot.u, l.u, across / 2) && within(spot.v, l.v, up / 2);
    }, "labels");
    return label ?? seamAt(spot.u);
  }
  if (spot.kind === "wall") {
    const onIt = (item: RawConfig, width: number, height: number) => item.wall === spot.wall && within(spot.at, item.at, width / 2) && within(spot.z, item.z, height / 2);
    return (
      firstIndex(list(config.wallHoles), (hole) => onIt(hole, hole.width, hole.height), "wallHoles") ??
      firstIndex(list(config.vents), (vent) => onIt(vent, vent.width, vent.height), "vents") ??
      firstIndex(labels, (l) => typeof l.wall === "string" && onIt(l, ...labelSize(l)), "labels") ??
      (spot.wall === "front" || spot.wall === "rear" ? seamAt(spot.at) : null)
    );
  }
  const near = (item: RawConfig, reach: number) => Math.hypot(item.x - spot.x, item.y - spot.y) <= reach + AROUND;
  if (spot.kind === "under") {
    return (
      firstIndex(list(plate.feet), (foot) => near(foot, (foot.diameter ?? 10) / 2), "plate.feet") ??
      firstIndex(list(plate.countersunkHoles), (hole) => near(hole, 4), "plate.countersunkHoles")
    );
  }
  return (
    firstIndex(list(plate.supports), (support) => near(support, 4), "plate.supports") ??
    firstIndex(list(plate.pins), (pin) => near(pin, (pin.diameter ?? 4) / 2), "plate.pins") ??
    firstIndex(list(plate.cableTies), (tie) => near(tie, 6), "plate.cableTies") ??
    firstIndex(list(plate.countersunkHoles), (hole) => near(hole, 4), "plate.countersunkHoles") ??
    firstIndex(list(plate.weights), (weight) => {
      const turned = weight.rotationDeg === 90 || weight.rotationDeg === 270;
      const [w, d] = turned ? [weight.depth, weight.width] : [weight.width, weight.depth];
      return within(spot.x, weight.x, w / 2) && within(spot.y, weight.y, d / 2);
    }, "plate.weights")
  );
}

// The faces under a click, nearest first. Something in particular wins over the bare surface or
// wall in front of it only where it can be seen through that: `through` is whether the view shows
// the inside. Otherwise it's the nearest face that decides.
export function thingAt(config: RawConfig, spots: (Spot | null)[], through: boolean): string | null {
  // A face that's no surface, wall or floor is passed over, such as the side of an engraved letter.
  const known = spots.filter((spot): spot is Spot => spot !== null);
  for (const spot of through ? known : known.slice(0, 1)) {
    const item = itemAt(config, spot);
    if (item) return item;
  }
  const front = known[0];
  if (!front) return null;
  if (front.kind === "surface") {
    const index = list(config.enclosure?.surfaces).findIndex((surface) => surface.id === front.surface);
    return index === -1 ? null : `enclosure.surfaces[${index}]`;
  }
  return front.kind === "wall" ? WALLS_PATH : null;
}

// Which tab has the fields for something at a path. All of these are on the Shape tab.
export function nameOfThing(path: string): string {
  const kinds: [RegExp, string][] = [
    [/^labels/, "label"],
    [/^wallHoles/, "hole"],
    [/^vents/, "vent"],
    [/^seams/, "seam"],
    [/^plate\.feet/, "foot"],
    [/^plate\.supports/, "support"],
    [/^plate\.pins/, "pin"],
    [/^plate\.cableTies/, "cable tie bridge"],
    [/^plate\.countersunkHoles/, "hole in the plate"],
    [/^plate\.weights/, "weight pocket"],
    [/^enclosure\.surfaces/, "surface"],
    [/^enclosure\.wall/, "walls"],
  ];
  return kinds.find(([pattern]) => pattern.test(path))?.[1] ?? "";
}
