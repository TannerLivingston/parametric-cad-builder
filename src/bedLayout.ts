import type { PartPrintReport } from "./printing.js";
import type { BuildPlan } from "./validate.js";

// Which parts can share a print. Parts of one colour go on as few beds as they fit, each as it's
// meant to print, though a part may lie a quarter turn round on the bed. Each one's footprint is
// its box as it prints, so they fit at least as well as this, often better.

export interface BedItem {
  index: number;
  name: string;
  color: string;
  width: number; // across the bed, as it prints
  depth: number;
  height: number;
  hours: number;
  grams: number;
}

export interface BedPlacement {
  index: number;
  name: string;
  x: number; // its front left corner on the bed
  y: number;
  width: number; // as it lies, once turned
  depth: number;
  turned: boolean;
}

export interface Bed {
  color: string;
  items: BedPlacement[];
  hours: number;
  grams: number;
  height: number; // its tallest part
}

export const BED_GAP = 5; // between parts, for the nozzle to get round and a brim
export const BED_EDGE = 5; // from the edge of the bed

interface Free {
  x: number;
  y: number;
  width: number;
  depth: number;
}

// Packs each colour onto beds, largest parts first, into the space that's left with the least to
// spare. Each part's room includes a gap on its right and rear, so the bed gets that gap back.
export function layoutBeds(items: BedItem[], bed: { x: number; y: number }): Bed[] {
  const beds: Bed[] = [];
  const colors = [...new Set(items.map((item) => item.color))];
  const roomX = bed.x - 2 * BED_EDGE + BED_GAP;
  const roomY = bed.y - 2 * BED_EDGE + BED_GAP;
  for (const color of colors) {
    const mine = items.filter((item) => item.color === color).sort((a, b) => b.width * b.depth - a.width * a.depth || a.index - b.index);
    const open: { bed: Bed; free: Free[] }[] = [];
    for (const item of mine) {
      let placed = false;
      for (const target of open) {
        if (place(target, item)) {
          placed = true;
          break;
        }
      }
      if (!placed) {
        const fresh = { bed: { color, items: [], hours: 0, grams: 0, height: 0 } as Bed, free: [{ x: 0, y: 0, width: roomX, depth: roomY }] };
        open.push(fresh);
        // One too big for an empty bed still gets one of its own, for the validator to have said so.
        if (!place(fresh, item)) fresh.bed.items.push({ index: item.index, name: item.name, x: BED_EDGE, y: BED_EDGE, width: item.width, depth: item.depth, turned: false });
      }
    }
    for (const { bed: each } of open) {
      const used = mine.filter((item) => each.items.some((p) => p.index === item.index));
      each.items.sort((a, b) => a.index - b.index);
      each.hours = used.reduce((sum, item) => sum + item.hours, 0);
      each.grams = used.reduce((sum, item) => sum + item.grams, 0);
      each.height = Math.max(...used.map((item) => item.height));
      beds.push(each);
    }
  }
  return beds;
}

// Puts an item in the free space it fits most tightly, either way round, and splits what's left.
function place(target: { bed: Bed; free: Free[] }, item: BedItem): boolean {
  let best: { free: Free; width: number; depth: number; turned: boolean; spare: number } | null = null;
  for (const free of target.free) {
    for (const turned of [false, true]) {
      const width = (turned ? item.depth : item.width) + BED_GAP;
      const depth = (turned ? item.width : item.depth) + BED_GAP;
      if (width > free.width + 1e-9 || depth > free.depth + 1e-9) continue;
      const spare = Math.min(free.width - width, free.depth - depth);
      if (!best || spare < best.spare - 1e-9) best = { free, width, depth, turned, spare };
    }
  }
  if (!best) return false;
  const { free, width, depth, turned } = best;
  target.bed.items.push({ index: item.index, name: item.name, x: BED_EDGE + free.x, y: BED_EDGE + free.y, width: width - BED_GAP, depth: depth - BED_GAP, turned });
  // The leftover beside it and behind it, cut along whichever way leaves the bigger piece whole.
  const right = free.width - width;
  const rear = free.depth - depth;
  const pieces: Free[] =
    right > rear
      ? [{ x: free.x + width, y: free.y, width: right, depth: free.depth }, { x: free.x, y: free.y + depth, width, depth: rear }]
      : [{ x: free.x + width, y: free.y, width: right, depth }, { x: free.x, y: free.y + depth, width: free.width, depth: rear }];
  target.free = [...target.free.filter((f) => f !== free), ...pieces.filter((p) => p.width > BED_GAP && p.depth > BED_GAP)];
  return true;
}

// The beds for a design, from how each part prints.
export function bedsFor(plan: BuildPlan, reports: PartPrintReport[]): Bed[] {
  const items = reports.map((report): BedItem => {
    const [width, depth, height] = report.best.size;
    return { index: report.index, name: report.name, color: plan.printedParts[report.index]!.color, width, depth, height, hours: report.estimate.hours, grams: report.estimate.grams };
  });
  return layoutBeds(items, plan.config.fabrication.buildVolume);
}

// "Deck 1, and Panel 2 turned", for one bed.
export function describeBed(bed: Bed): string {
  const names = bed.items.map((item) => (item.turned ? `${item.name} turned a quarter` : item.name));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";
}
