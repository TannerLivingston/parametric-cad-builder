// A 3MF for each bed, with its parts already where they go, so a slicer opens it ready to print.
// It's the plain core format, which every slicer reads, rather than any one slicer's project.
import { bedsFor, type BedPlacement } from "./bedLayout.js";
import { weldMesh, type PartMeshData, type PartPrintReport } from "./printing.js";
import type { BuildPlan } from "./validate.js";
import { writeZip, type ZipFile } from "./zip.js";

export interface BedMesh {
  name: string;
  vertices: number[];
  triangles: ArrayLike<number>;
  color?: string; // as "#rrggbb"
  inlays?: BedMesh[]; // parts of the same object, to print in their own filament
}

// Takes a part as it prints, standing on the bed, and moves it to its spot there, turned a quarter
// about its middle if the layout says so.
// A part and its inlays, moved together, by the part's own corner.
export function placeWithInlays(name: string, mesh: PartMeshData, inlays: { name: string; color: string; mesh: PartMeshData }[], placement: Pick<BedPlacement, "x" | "y" | "turned">, color?: string): BedMesh {
  const { minX, minY } = corner(mesh, placement.turned);
  const move = (m: PartMeshData) => moved(m, placement, minX, minY);
  return { name, ...move(mesh), ...(color && { color }), ...(inlays.length && { inlays: inlays.map((inlay) => ({ name: inlay.name, color: inlay.color, ...move(inlay.mesh) })) }) };
}

function corner(mesh: PartMeshData, turned: boolean) {
  let [minX, minY] = [Infinity, Infinity];
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    const x = mesh.vertices[i]!;
    const y = mesh.vertices[i + 1]!;
    minX = Math.min(minX, turned ? -y : x);
    minY = Math.min(minY, turned ? x : y);
  }
  return { minX, minY };
}

function moved(mesh: PartMeshData, placement: Pick<BedPlacement, "x" | "y" | "turned">, minX: number, minY: number): { vertices: number[]; triangles: ArrayLike<number> } {
  const vertices: number[] = new Array(mesh.vertices.length);
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    const x = mesh.vertices[i]!;
    const y = mesh.vertices[i + 1]!;
    vertices[i] = (placement.turned ? -y : x) - minX + placement.x;
    vertices[i + 1] = (placement.turned ? x : y) - minY + placement.y;
    vertices[i + 2] = mesh.vertices[i + 2]!;
  }
  return { vertices, triangles: mesh.triangles };
}

export function placeMesh(name: string, mesh: PartMeshData, placement: Pick<BedPlacement, "x" | "y" | "turned">): BedMesh {
  const count = mesh.vertices.length / 3;
  const turned: number[] = new Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = mesh.vertices[i * 3]!;
    const y = mesh.vertices[i * 3 + 1]!;
    turned[i * 3] = placement.turned ? -y : x;
    turned[i * 3 + 1] = placement.turned ? x : y;
    turned[i * 3 + 2] = mesh.vertices[i * 3 + 2]!;
  }
  let minX = Infinity;
  let minY = Infinity;
  for (let i = 0; i < count; i++) {
    minX = Math.min(minX, turned[i * 3]!);
    minY = Math.min(minY, turned[i * 3 + 1]!);
  }
  for (let i = 0; i < count; i++) {
    turned[i * 3] = turned[i * 3]! - minX + placement.x;
    turned[i * 3 + 1] = turned[i * 3 + 1]! - minY + placement.y;
  }
  return { name, vertices: turned, triangles: mesh.triangles };
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const number = (value: number) => String(Math.round(value * 10000) / 10000);

export function write3mf(meshes: BedMesh[]): Uint8Array {
  // Every colour once, for the slicer to show, and to match to a filament.
  const colors = [...new Set(meshes.flatMap((mesh) => [mesh.color, ...(mesh.inlays ?? []).map((inlay) => inlay.color)]).filter((c): c is string => c !== undefined && HEX.test(c)))];
  const objects: string[] = [];
  const items: number[] = [];
  let next = 1;
  const meshObject = (mesh: BedMesh): number => {
    const id = next++;
    // Shared corners, so a slicer sees a closed solid rather than loose triangles.
    const welded = weldMesh(mesh);
    const vertices: string[] = [];
    for (let v = 0; v < welded.points.length; v += 3) vertices.push(`<vertex x="${number(welded.points[v]!)}" y="${number(welded.points[v + 1]!)}" z="${number(welded.points[v + 2]!)}"/>`);
    const triangles: string[] = [];
    for (let t = 0; t < welded.triangles.length; t += 3) triangles.push(`<triangle v1="${welded.triangles[t]}" v2="${welded.triangles[t + 1]}" v3="${welded.triangles[t + 2]}"/>`);
    const material = mesh.color && HEX.test(mesh.color) ? ` pid="${MATERIALS}" pindex="${colors.indexOf(mesh.color)}"` : "";
    objects.push(`<object id="${id}" type="model" name="${escape(mesh.name)}"${material}><mesh><vertices>${vertices.join("")}</vertices><triangles>${triangles.join("")}</triangles></mesh></object>`);
    return id;
  };
  for (const mesh of meshes) {
    if (!mesh.inlays?.length) {
      items.push(meshObject(mesh));
      continue;
    }
    // One object of several parts, so they stay together, each in its own filament.
    const parts = [meshObject(mesh), ...mesh.inlays.map(meshObject)];
    const id = next++;
    objects.push(`<object id="${id}" type="model" name="${escape(mesh.name)}"><components>${parts.map((part) => `<component objectid="${part}"/>`).join("")}</components></object>`);
    items.push(id);
  }
  const materials = colors.length ? `<basematerials id="${MATERIALS}">${colors.map((color) => `<base name="${escape(color)}" displaycolor="${color.toUpperCase()}FF"/>`).join("")}</basematerials>` : "";
  const model = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    `<resources>${materials}${objects.join("")}</resources>`,
    `<build>${items.map((id) => `<item objectid="${id}"/>`).join("")}</build>`,
    "</model>",
  ].join("\n");
  const types = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  const encoder = new TextEncoder();
  return writeZip([
    { name: "[Content_Types].xml", bytes: encoder.encode(types) },
    { name: "_rels/.rels", bytes: encoder.encode(rels) },
    { name: "3D/3dmodel.model", bytes: encoder.encode(model) },
  ]);
}

const MATERIALS = 1000; // the colours' id, apart from the objects'
const HEX = /^#[0-9a-f]{6}$/i;

// A file for each bed that holds more than one part, or a part with inlays, which a slicer needs as
// one object. `meshOf` gives a part as it prints, on the bed, and `inlaysOf` what fills its labels.
export function bedFiles(plan: BuildPlan, reports: PartPrintReport[], meshOf: (index: number) => PartMeshData, inlaysOf: (index: number) => { color: string; mesh: PartMeshData }[] = () => []): ZipFile[] {
  return bedsFor(plan, reports).flatMap((bed, i) => {
    const inlays = bed.items.map((item) => inlaysOf(item.index));
    if (bed.items.length < 2 && !inlays.some((list) => list.length)) return [];
    const meshes = bed.items.map((item, n) =>
      placeWithInlays(item.name, meshOf(item.index), inlays[n]!.map((inlay) => ({ name: `${item.name} labels`, color: inlay.color, mesh: inlay.mesh })), item, plan.printedParts[item.index]!.color),
    );
    return [{ name: `bed-${i + 1}.3mf`, bytes: write3mf(meshes) }];
  });
}
