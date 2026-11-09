// Places to start from, each valid as it stands. They're only configs, so everything about them can
// be changed afterwards. Sizes are starting points for the Centauri Carbon 2's 256 mm bed.
import type { RawConfig } from "./configEdit.js";
import { newEnclosure } from "./shapeEdit.js";

const grid = (type: string, surface: string, columns: number, rows: number, u: number, v: number, stepU: number, stepV: number) =>
  Array.from({ length: columns * rows }, (_, i) => ({ id: `${type}-${i + 1}`, type, surface, u: u + (i % columns) * stepU, v: v + Math.floor(i / columns) * stepV }));

export const TEMPLATES: { name: string; description: string; make(): RawConfig }[] = [
  { name: "Empty box", description: "A plain box with a separate top", make: newEnclosure },
  {
    name: "Desktop wedge",
    description: "A sloped front, tilted towards you",
    make: () => ({
      schemaVersion: 1,
      name: "Desktop wedge",
      enclosure: { width: 220, frontHeight: 22, surfaces: [{ id: "face", y: 130, z: 60 }, { id: "back", y: 150, z: 60 }], wall: 2.4, floorThickness: 2.4 },
      topPanels: [{ surface: "face" }],
      components: [],
    }),
  },
  {
    name: "Button box",
    description: "Eight arcade buttons and a USB board",
    make: () => ({
      schemaVersion: 1,
      name: "Button box",
      enclosure: { width: 170, frontHeight: 40, surfaces: [{ id: "top", y: 120, z: 40 }], wall: 2.4, floorThickness: 2.4 },
      topPanels: [{ surface: "top" }],
      components: [...grid("arcade-24mm", "top", 4, 2, 40, 45, 30, 30), { id: "mcu", type: "rp2040-plus", x: 28.4, y: 102 }],
    }),
  },
  {
    name: "Dial controller",
    description: "Four dials and a screen on a sloped face",
    make: () => ({
      schemaVersion: 1,
      name: "Dial controller",
      enclosure: { width: 200, frontHeight: 25, surfaces: [{ id: "face", y: 110, z: 55 }, { id: "back", y: 130, z: 55 }], wall: 2.4, floorThickness: 2.4 },
      topPanels: [{ surface: "face" }],
      components: [...grid("ec11-dial-19mm", "face", 4, 1, 40, 85, 40, 0), { id: "screen", type: "oled-242-ssd1309", surface: "face", u: 100, v: 40 }, { id: "mcu", type: "rp2040-plus", x: 28.4, y: 100 }],
    }),
  },
  {
    name: "Foot pedal",
    description: "A heavy wedge with thick walls, to stamp on",
    make: () => ({
      schemaVersion: 1,
      name: "Foot pedal",
      enclosure: { width: 130, frontHeight: 30, surfaces: [{ id: "top", y: 200, z: 65 }], wall: 3.2, panelThickness: 3, floorThickness: 3.2 },
      topPanels: [{ surface: "top" }],
      components: grid("arcade-24mm", "top", 2, 1, 40, 120, 50, 0),
    }),
  },
  {
    name: "Wide controller",
    description: "Too wide for the bed, so in two halves with a seam",
    make: () => ({
      schemaVersion: 1,
      name: "Wide controller",
      enclosure: { width: 360, frontHeight: 28, surfaces: [{ id: "deck", y: 90, z: 28 }, { id: "panel", y: 130, z: 54 }, { id: "back", y: 200, z: 44 }], wall: 3, floorThickness: 3, cornerRadius: 10 },
      seams: [{ x: 180 }],
      topPanels: [{ surface: "deck", splits: [130] }, { surface: "panel", splits: [130] }],
      components: [],
    }),
  },
];
