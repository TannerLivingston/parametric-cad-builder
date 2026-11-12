// What's at a click in the view, as its path in the config: a label, a hole or vent in a wall, a
// seam, something on the plate, a screw, the plate's split, the opening or a box of room kept in
// it, or failing those the surface or wall itself. Parts aren't here, since they have markers of
// their own to click, but a part's own label is, as `labels[i]` with a `component`.
import { textOutline } from "../lettering.js";
import type { RawConfig } from "./configEdit.js";
import type { Spot } from "./pickSpot.js";

const AROUND = 1.5; // how far outside something a click still counts as on it
const SEAM_REACH = 2; // either side of a seam's line
const JOINT_REACH = 4; // either side of the plate's split, a thin line seen from below
export const WALLS_PATH = "enclosure.wall"; // what a click on a bare wall selects: the walls' own settings

const SCREW_REACH = 4.5; // from a screw's centre
export const FASTENER_PREFIX = "fastener:"; // a screw, by its id on the Screws tab

// What the validator worked out that the config alone doesn't say: where each label went, a part's
// own included, where the screws are, and where the plate splits. And for each spot, the point
// clicked, to find a screw by.
export interface PickExtras {
  labels?: { source: number; across: number; up: number; on: { kind: "surface"; surface: string; u: number; v: number } | { kind: "wall"; wall: string; at: number; z: number } }[];
  fasteners?: { id: string; kind: "plate" | "top"; x: number; y: number; z: number; surface: string | null }[];
  plateJoints?: number[];
  floorThickness?: number;
  points?: (readonly [number, number, number])[];
}

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
function itemAt(config: RawConfig, spot: Spot, point: readonly [number, number, number] | undefined, extras: PickExtras): string | null {
  const labels = list(config.labels);
  const seams = list(config.seams);
  const plate: RawConfig = config.plate ?? {};
  const seamAt = (x: number) => firstIndex(seams, (seam) => Math.abs(seam.x - x) <= SEAM_REACH, "seams");
  // Where the validator put them, if it has, so that a part's own label is found too.
  const placedLabel = (test: (on: NonNullable<PickExtras["labels"]>[number]["on"], across: number, up: number) => boolean) => {
    const found = extras.labels?.find((l) => test(l.on, l.across, l.up));
    return found ? `labels[${found.source}]` : null;
  };
  if (spot.kind === "surface") {
    const first = config.enclosure?.surfaces?.[0]?.id;
    const label = extras.labels
      ? placedLabel((on, across, up) => on.kind === "surface" && on.surface === spot.surface && within(spot.u, on.u, across / 2) && within(spot.v, on.v, up / 2))
      : firstIndex(labels, (l) => {
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
      (extras.labels
        ? placedLabel((on, across, up) => on.kind === "wall" && on.wall === spot.wall && within(spot.at, on.at, across / 2) && within(spot.z, on.z, up / 2))
        : firstIndex(labels, (l) => typeof l.wall === "string" && onIt(l, ...labelSize(l)), "labels")) ??
      (spot.wall === "front" || spot.wall === "rear" ? seamAt(spot.at) : null) ??
      // The front wall that's left below the opening, its sill.
      (spot.wall === "front" && config.opening && spot.at >= config.opening.xMin && spot.at <= config.opening.xMax ? "opening" : null)
    );
  }
  const jointAt = (x: number) => ((extras.plateJoints ?? [plate.seamX ?? []].flat()).some((joint: number) => Math.abs(joint - x) <= JOINT_REACH) ? "plate.seamX" : null);
  const near = (item: RawConfig, reach: number) => Math.hypot(item.x - spot.x, item.y - spot.y) <= reach + AROUND;
  if (spot.kind === "under") {
    return (
      firstIndex(list(plate.feet), (foot) => near(foot, (foot.diameter ?? 10) / 2), "plate.feet") ??
      firstIndex(list(plate.countersunkHoles), (hole) => near(hole, 4), "plate.countersunkHoles") ??
      jointAt(spot.x)
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
    }, "plate.weights") ??
    jointAt(spot.x) ??
    openingAt(config, spot.x, spot.y)
  );
}

// The opening's floor: a box of room kept in it, or the opening itself.
function openingAt(config: RawConfig, x: number, y: number): string | null {
  const opening = config.opening;
  if (!opening || x < opening.xMin || x > opening.xMax || y > opening.yEnd) return null;
  return firstIndex(list(opening.keepOut), (box) => x >= box.xMin && x <= box.xMax && y >= box.yMin && y <= box.yMax, "opening.keepOut") ?? "opening";
}

// The faces under a click, nearest first. Something in particular wins over the bare surface or
// wall in front of it only where it can be seen through that: `through` is whether the view shows
// the inside. Otherwise it's the nearest face that decides.
// A screw at the point clicked, its head or its hole, whatever face that is: one into the plate seen
// from below it, and one into a top panel from above its post.
function screwAt(point: readonly [number, number, number] | undefined, extras: PickExtras): string | null {
  if (!point) return null;
  const found = extras.fasteners?.find(
    (f) => Math.hypot(f.x - point[0], f.y - point[1]) <= SCREW_REACH && (f.kind === "plate" ? point[2] <= f.z + SCREW_REACH : point[2] >= f.z),
  );
  return found ? `${FASTENER_PREFIX}${found.id}` : null;
}

export function thingAt(config: RawConfig, spots: (Spot | null)[], through: boolean, extras: PickExtras = {}): string | null {
  const first = extras.points?.[0];
  const screw = screwAt(first, extras);
  if (screw) return screw;
  // The gap between the plate's pieces is no floor or underside, but it's the split.
  if (first && extras.plateJoints && first[2] <= (extras.floorThickness ?? 3) + 0.5 && extras.plateJoints.some((x) => Math.abs(x - first[0]) <= JOINT_REACH)) return "plate.seamX";
  // A face that's no surface, wall or floor is passed over, such as the side of an engraved letter.
  const known = spots.flatMap((spot, i) => (spot ? [{ spot, point: extras.points?.[i] }] : []));
  for (const { spot, point } of through ? known : known.slice(0, 1)) {
    const item = itemAt(config, spot, point, extras);
    if (item) return item;
  }
  const front = known[0]?.spot;
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
    [/^plate\.seamX/, "plate's split"],
    [/^opening\.keepOut/, "room kept in the opening"],
    [/^opening/, "opening"],
    [new RegExp(`^${FASTENER_PREFIX}`), "screw"],
    [/^enclosure\.wall/, "walls"],
  ];
  return kinds.find(([pattern]) => pattern.test(path))?.[1] ?? "";
}

// The part whose own label is at a path, if it's one.
export function partOfLabel(config: RawConfig, path: string): string | null {
  const match = /^labels\[(\d+)\]$/.exec(path);
  const label = match ? list(config.labels)[Number(match[1])] : undefined;
  return typeof label?.component === "string" ? label.component : null;
}

const mm = (value: unknown) => `${Math.round(Number(value) * 100) / 100} mm`;
const wallName = (wall: unknown) => `the ${String(wall)} wall`;

// What something is, in a line, with its main sizes, for when the pointer rests on it in the view.
// `partNames` gives each part type's name.
export function describeThing(config: RawConfig, path: string, partNames: Record<string, string> = {}): string | null {
  const at = (pattern: RegExp, list: unknown) => {
    const match = pattern.exec(path);
    return match && Array.isArray(list) ? (list[Number(match[1])] as RawConfig | undefined) ?? null : null;
  };
  const plate: RawConfig = config.plate ?? {};
  if (path.startsWith(FASTENER_PREFIX)) return "A screw, with a brass insert. Click to move it on the Screws tab.";
  const component = /^components:(.+)$/.exec(path);
  if (component) {
    const c = list(config.components).find((item) => item.id === component[1]);
    if (!c) return null;
    const name = partNames[c.type] ?? c.type;
    const where = "wall" in c ? `in ${wallName(c.wall)}` : "x" in c ? "on the floor" : `on ${c.surface ?? config.enclosure?.surfaces?.[0]?.id}`;
    return `${c.id}: ${name}, ${where}`;
  }
  const label = at(/^labels\[(\d+)\]$/, config.labels);
  if (label) {
    const where = typeof label.component === "string" ? `beside ${label.component}` : typeof label.wall === "string" ? `on ${wallName(label.wall)}` : `on ${label.surface ?? config.enclosure?.surfaces?.[0]?.id}`;
    return `Label "${label.text}", ${mm(label.size ?? 5)} tall, ${where}`;
  }
  const hole = at(/^wallHoles\[(\d+)\]$/, config.wallHoles);
  if (hole) return `Hole in ${wallName(hole.wall)}, ${mm(hole.width)} by ${mm(hole.height)}`;
  const vent = at(/^vents\[(\d+)\]$/, config.vents);
  if (vent) return `Vent in ${wallName(vent.wall)}, ${mm(vent.width)} by ${mm(vent.height)}`;
  const seam = at(/^seams\[(\d+)\]$/, config.seams);
  if (seam) return `Seam at ${mm(seam.x)} from the left${seam.lip ? `, with a ${mm(seam.lip)} lip` : ""}`;
  const foot = at(/^plate\.feet\[(\d+)\]$/, plate.feet);
  if (foot) return `Rubber foot, ${mm(foot.diameter ?? 10)} across`;
  const support = at(/^plate\.supports\[(\d+)\]$/, plate.supports);
  if (support) return "Support, up from the plate to the top";
  const pin = at(/^plate\.pins\[(\d+)\]$/, plate.pins);
  if (pin) return `Pin, ${mm(pin.diameter)} across and ${mm(pin.height)} tall`;
  const tie = at(/^plate\.cableTies\[(\d+)\]$/, plate.cableTies);
  if (tie) return "Cable tie bridge";
  if (at(/^plate\.countersunkHoles\[(\d+)\]$/, plate.countersunkHoles)) return "Hole in the plate, for a screw from below";
  const weight = at(/^plate\.weights\[(\d+)\]$/, plate.weights);
  if (weight) return `Weight pocket, ${mm(weight.width)} by ${mm(weight.depth)}`;
  if (path === "plate.seamX") return "Where the plate splits into pieces";
  const box = at(/^opening\.keepOut\[(\d+)\]$/, config.opening?.keepOut);
  if (box) return `Room kept clear in the opening, up to ${mm(box.top)} high`;
  if (path === "opening" && config.opening) return `The opening, ${mm(config.opening.xMin)} to ${mm(config.opening.xMax)} from the left`;
  const surface = at(/^enclosure\.surfaces\[(\d+)\]$/, config.enclosure?.surfaces);
  if (surface) return `Surface "${surface.id}", ending ${mm(surface.y)} back at ${mm(surface.z)} high${surface.bulge ? `, curved by ${mm(surface.bulge)}` : ""}`;
  if (path === WALLS_PATH) return `The walls, ${mm(config.enclosure?.wall ?? 3)} thick`;
  return null;
}
