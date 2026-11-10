// The 3D view: printed parts from the engine, plus a marker for every component that
// can be picked and dragged. Markers come from the config rather than the engine, so
// they follow the pointer at once, even when the layout is invalid. World axes match
// the engine: X is width, Y runs front to rear, and Z is up.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { surfacePoint, type Surface } from "../profile.js";
import type { FastenerEdge, PlannedFastener, WiringPlan } from "../validate.js";
import type { BedView, PartKind, PartMesh } from "./engineClient.js";
import { curveCoordinates, explodeOffset, sectionPlane, surfaceCoordinates, type Box2, type Section, type SceneComponent, type SceneModel } from "./sceneModel.js";

export type ViewPreset = "iso" | "top" | "front" | "under";

export interface SceneEvents {
  onSelect(id: string | null): void;
  onDragStart(id: string): void;
  onDrag(id: string, a: number, b: number): void;
  onDragEnd(id: string): void;
  onFastenerSelect(id: string | null): void;
  onFastenerDrag(id: string, x: number, y: number): void;
  onFastenerDrop(id: string, x: number, y: number): void;
  onMeasure(points: [number, number, number][]): void;
}

export interface SceneColors {
  background: string;
  shell: string;
  shellAlt: string;
  edge: string;
  marker: string;
  wire: string;
  selected: string;
  invalid: string;
  changed: string;
  steep: string;
}

export interface FastenerView {
  items: PlannedFastener[];
  edges: FastenerEdge[];
  selected: string | null;
}

const FASTENER_DIAMETER = 10; // a little wider than the real boss, to be easy to grab
const FASTENER_HEIGHT = 8;
const SNAP_TO_WALL = 4;
const FASTENER_STEP = 0.5;
const SNAP_TO_CORNER = 1.5;

interface PartObjects {
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  // A cut shows a part's inside faces. Unlit, in one colour, they look like the solid that was cut.
  cut: THREE.Mesh;
}

interface Marker {
  component: SceneComponent;
  group: THREE.Group;
  pick: THREE.Mesh;
}

const PRESETS: Record<ViewPreset, [number, number, number]> = {
  iso: [0.35, -0.8, 0.75],
  top: [0, -0.001, 1],
  front: [0, -1, 0.12],
  under: [0.35, -0.6, -0.8],
};

function outlineShape(box: Box2): THREE.Shape {
  const shape = new THREE.Shape();
  if (box.shape === "circle") shape.absarc(0, 0, box.hu, 0, Math.PI * 2, false);
  else {
    shape.moveTo(-box.hu, -box.hv);
    shape.lineTo(box.hu, -box.hv);
    shape.lineTo(box.hu, box.hv);
    shape.lineTo(-box.hu, box.hv);
    shape.closePath();
  }
  return shape;
}

const REFERENCE_COLOR = "#2f80ed";

export class Scene3D {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 1, 8000);
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private parts = new Map<number, PartObjects>();
  private partKinds: PartKind[] = [];
  private partColors: string[] = [];
  private partMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private cutMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private markers: Marker[] = [];
  private markerRoot = new THREE.Group();
  private model: SceneModel | null = null;
  private selected: string | null = null;
  private invalid = new Set<string>();
  private gap = 0;
  private internals = false;
  private focus: Set<number> | null = null; // the printed parts an assembly step is about, with the rest faded
  private fadedMaterial = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.9, transparent: true, opacity: 0.12, depthWrite: false });
  private raycaster = new THREE.Raycaster();
  private drag: { id: string; plane: THREE.Plane; offset: [number, number]; surface: Surface | null; moved: boolean } | null = null;
  private preview: THREE.Group | null = null;
  private reference: THREE.Group | null = null;
  private highlight: THREE.Group | null = null;
  private wires: THREE.Group | null = null;
  private measuring = false;
  private measurePoints: [number, number, number][] = [];
  private measureMarks: THREE.Group | null = null;
  private section: THREE.Plane | null = null;
  private fasteners: FastenerView | null = null;
  private fastenerMarkers: { item: PlannedFastener; group: THREE.Group; pick: THREE.Mesh }[] = [];
  private fastenerDrag: { item: PlannedFastener; plane: THREE.Plane; x: number; y: number; moved: boolean } | null = null;
  private observer: ResizeObserver;
  private framedSize: string | null = null;
  private frameRequested = false;
  private shellMaterial: THREE.MeshStandardMaterial;
  private shellAltMaterial: THREE.MeshStandardMaterial;
  private edgeMaterial: THREE.LineBasicMaterial;

  constructor(private container: HTMLElement, private events: SceneEvents, private colors: SceneColors) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.append(this.renderer.domElement);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener("change", () => this.requestFrame());

    const materialFor = (color: string) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.shellMaterial = materialFor(colors.shell);
    this.shellAltMaterial = materialFor(colors.shellAlt);
    this.edgeMaterial = new THREE.LineBasicMaterial({ color: colors.edge });

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(-150, -300, 500);
    this.scene.add(key);
    this.scene.add(this.markerRoot);
    this.scene.background = new THREE.Color(colors.background);

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.handleDown);
    canvas.addEventListener("pointermove", this.handleMove);
    canvas.addEventListener("pointerup", this.handleUp);
    canvas.addEventListener("pointercancel", this.handleUp);
    canvas.addEventListener("lostpointercapture", this.handleUp);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  setColors(colors: SceneColors) {
    this.colors = colors;
    this.scene.background = new THREE.Color(colors.background);
    this.shellMaterial.color.set(colors.shell);
    this.shellAltMaterial.color.set(colors.shellAlt);
    this.edgeMaterial.color.set(colors.edge);
    this.rebuildMarkers();
  }

  setParts(meshes: PartMesh[], partKinds: PartKind[], partColors: string[]) {
    const partCount = partKinds.length;
    this.partKinds = partKinds;
    this.partColors = partColors;
    for (const mesh of meshes) {
      const existing = this.parts.get(mesh.index);
      if (existing) {
        this.scene.remove(existing.mesh, existing.edges, existing.cut);
        existing.mesh.geometry.dispose();
        existing.edges.geometry.dispose();
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(mesh.vertices, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(mesh.triangles, 1));
      const edgeGeometry = new THREE.BufferGeometry();
      edgeGeometry.setAttribute("position", new THREE.BufferAttribute(mesh.edges, 3));
      const objects = {
        mesh: new THREE.Mesh(geometry, this.materialFor(partColors[mesh.index]!)),
        edges: new THREE.LineSegments(edgeGeometry, this.edgeMaterial),
        cut: new THREE.Mesh(geometry, this.cutMaterialFor(partColors[mesh.index]!)),
      };
      this.parts.set(mesh.index, objects);
      this.scene.add(objects.mesh, objects.edges, objects.cut);
    }
    for (const [index, objects] of this.parts) {
      if (index >= partCount) {
        this.scene.remove(objects.mesh, objects.edges, objects.cut);
        objects.mesh.geometry.dispose();
        objects.edges.geometry.dispose();
        this.parts.delete(index);
      }
    }
    this.applyLayout();
    this.showDesign();
    // Follows the enclosure when its size changes, without moving the view for anything else.
    const size = this.partBounds().getSize(new THREE.Vector3()).toArray().map(Math.round).join();
    if (this.framedSize === null) this.setView("iso");
    else if (size !== this.framedSize && !this.preview) this.fit(this.camera.position.clone().sub(this.controls.target).normalize());
    this.framedSize = size;
    this.requestFrame();
  }

  setModel(model: SceneModel | null, selected: string | null, invalid: Set<string>) {
    this.model = model ?? this.model;
    this.selected = selected;
    this.invalid = invalid;
    this.rebuildMarkers();
  }

  // While these are shown they're what can be picked, so that parts can't move by accident.
  setFasteners(view: FastenerView | null) {
    this.fasteners = view;
    if (!this.fastenerDrag) this.rebuildMarkers();
  }

  // Shows whether the spot under a dragged screw is a good one.
  setFastenerDragProblem(problem: boolean) {
    const marker = this.fastenerMarkers.find((m) => m.item.id === this.fastenerDrag?.item.id);
    (marker?.pick.material as THREE.MeshBasicMaterial | undefined)?.color.set(problem ? this.colors.invalid : this.colors.selected);
    this.requestFrame();
  }

  // Shows these instead of the design, side by side along x.
  setPreview(meshes: PartMesh[] | null) {
    let group: THREE.Group | null = null;
    if (meshes) {
      group = new THREE.Group();
      let x = 0;
      for (const part of meshes) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(part.vertices, 3));
        geometry.setAttribute("normal", new THREE.BufferAttribute(part.normals, 3));
        geometry.setIndex(new THREE.BufferAttribute(part.triangles, 1));
        const edgeGeometry = new THREE.BufferGeometry();
        edgeGeometry.setAttribute("position", new THREE.BufferAttribute(part.edges, 3));
        const piece = new THREE.Group();
        piece.add(new THREE.Mesh(geometry, this.shellMaterial), new THREE.Mesh(geometry, this.cutMaterialFor(this.colors.shell)), new THREE.LineSegments(edgeGeometry, this.edgeMaterial));
        geometry.computeBoundingBox();
        piece.position.x = x;
        x += geometry.boundingBox!.max.x + 12;
        group.add(piece);
      }
    }
    this.replacePreview(group);
    this.setView(meshes ? "top" : "iso");
  }

  // One part as it prints, on the bed, with its overhangs coloured and a marker on each gap.
  setBedView(view: BedView | null) {
    if (!view) {
      this.setPreview(null);
      return;
    }
    const preview = new THREE.Group();
    const v = view.vertices;
    const t = view.triangles;
    const positions = new Float32Array(t.length * 3);
    const shades = new Float32Array(t.length * 3);
    const base = new THREE.Color(this.colors.shell);
    const steep = new THREE.Color(this.colors.steep);
    const roof = new THREE.Color(this.colors.invalid);
    for (let i = 0; i < t.length; i += 3) {
      const corner = [0, 1, 2].map((k) => new THREE.Vector3(v[t[i + k]! * 3]!, v[t[i + k]! * 3 + 1]!, v[t[i + k]! * 3 + 2]!));
      const normal = corner[1]!.clone().sub(corner[0]!).cross(corner[2]!.clone().sub(corner[0]!)).normalize();
      const onBed = Math.max(corner[0]!.z, corner[1]!.z, corner[2]!.z) < 0.3;
      const color = onBed || normal.z >= -Math.SQRT1_2 ? base : normal.z < -0.94 ? roof : steep;
      corner.forEach((p, k) => {
        positions.set([p.x, p.y, p.z], (i + k) * 3);
        shades.set([color.r, color.g, color.b], (i + k) * 3);
      });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(shades, 3));
    geometry.computeVertexNormals();
    preview.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })), new THREE.Mesh(geometry, this.cutMaterialFor(this.colors.shell)));
    const edges = new THREE.BufferGeometry();
    edges.setAttribute("position", new THREE.BufferAttribute(view.edges, 3));
    preview.add(new THREE.LineSegments(edges, this.edgeMaterial));
    const { x, y, z } = view.bed;
    const box = new THREE.BoxGeometry(x, y, z);
    const volume = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: this.colors.marker, transparent: true, opacity: 0.5 }));
    volume.position.set(x / 2, y / 2, z / 2);
    preview.add(volume);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(x, y), new THREE.MeshBasicMaterial({ color: this.colors.marker, transparent: true, opacity: 0.15, depthWrite: false, side: THREE.DoubleSide }));
    plate.position.set(x / 2, y / 2, -0.05);
    preview.add(plate);
    for (const [gapX, gapY, gapZ] of view.gaps) {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 8), new THREE.MeshBasicMaterial({ color: this.colors.invalid, depthTest: false, transparent: true }));
      marker.position.set(gapX, gapY, gapZ);
      marker.renderOrder = 2;
      preview.add(marker);
    }
    this.replacePreview(preview);
    this.setView("iso");
  }

  // A part's own model, see-through, so the design shows through it. It can be measured.
  setReference(reference: { mesh: PartMesh; middle: [number, number, number]; matrix: number[]; offset: [number, number, number] } | null) {
    if (this.reference) {
      this.reference.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
      this.scene.remove(this.reference);
      this.reference = null;
    }
    if (reference) {
      const { mesh, middle, matrix: m, offset } = reference;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(mesh.vertices, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(mesh.triangles, 1));
      const edgeGeometry = new THREE.BufferGeometry();
      edgeGeometry.setAttribute("position", new THREE.BufferAttribute(mesh.edges, 3));
      const group = new THREE.Group();
      group.add(
        new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: REFERENCE_COLOR, transparent: true, opacity: 0.45, depthWrite: false, roughness: 0.6 })),
        new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: REFERENCE_COLOR })),
      );
      // Moved to its middle first, then turned and placed.
      const toMiddle = new THREE.Matrix4().makeTranslation(-middle[0], -middle[1], -middle[2]);
      const placed = new THREE.Matrix4().set(m[0]!, m[1]!, m[2]!, offset[0], m[3]!, m[4]!, m[5]!, offset[1], m[6]!, m[7]!, m[8]!, offset[2], 0, 0, 0, 1);
      group.applyMatrix4(placed.multiply(toMiddle));
      this.reference = group;
      this.scene.add(group);
    }
    this.showDesign();
  }

  private replacePreview(group: THREE.Group | null) {
    if (this.preview) {
      this.preview.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
      this.scene.remove(this.preview);
    }
    this.preview = group;
    if (group) this.scene.add(group);
    this.showDesign();
  }

  // Fades every printed part but these, or none for null.
  setFocus(parts: number[] | null) {
    this.focus = parts ? new Set(parts) : null;
    this.showDesign();
  }

  private showDesign() {
    for (const [index, { mesh, edges, cut }] of this.parts) {
      const faded = this.focus !== null && !this.focus.has(index);
      mesh.material = faded ? this.fadedMaterial : this.materialFor(this.partColors[index]!);
      mesh.visible = !this.preview;
      edges.visible = !this.preview && !faded;
      cut.visible = !this.preview && this.section !== null && !this.internals;
    }
    this.markerRoot.visible = !this.preview;
    if (this.reference) this.reference.visible = !this.preview;
    this.requestFrame();
  }

  // Marks where a problem is, seen through whatever's in front of it.
  setHighlight(box: { min: [number, number, number]; max: [number, number, number] } | null) {
    if (this.highlight) {
      this.highlight.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
      this.scene.remove(this.highlight);
      this.highlight = null;
    }
    if (box) {
      const size = box.max.map((value, axis) => Math.max(value - box.min[axis]!, 1)) as [number, number, number];
      const geometry = new THREE.BoxGeometry(...size);
      const group = new THREE.Group();
      const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: this.colors.invalid, transparent: true, opacity: 0.2, depthTest: false, depthWrite: false }));
      fill.renderOrder = 3;
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: this.colors.invalid, depthTest: false, transparent: true }));
      outline.renderOrder = 3;
      group.add(fill, outline);
      group.position.set((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2);
      this.highlight = group;
      this.scene.add(group);
    }
    this.requestFrame();
  }

  // Where each part's wires leave it, as see-through boxes, and their ways across the floor, as lines,
  // all seen through whatever's in front of them.
  setWires(view: (WiringPlan & { floor: number }) | null) {
    if (this.wires) {
      this.wires.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
      this.scene.remove(this.wires);
      this.wires = null;
    }
    if (view) {
      const group = new THREE.Group();
      const color = this.colors.wire;
      const fill = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
      const line = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
      for (const room of view.rooms) {
        if (room.length === 0) continue;
        // The outline across x, at each end, joined up.
        const { xLow, xHigh, section } = room.prism;
        const corners = [...section.map(([y, z]) => [xLow, y, z]), ...section.map(([y, z]) => [xHigh, y, z])].flat();
        const n = section.length;
        const faces: number[] = [];
        for (let i = 1; i < n - 1; i++) faces.push(0, i, i + 1, n, n + i + 1, n + i);
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          faces.push(i, j, n + j, i, n + j, n + i);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(corners, 3));
        geometry.setIndex(faces);
        const mesh = new THREE.Mesh(geometry, fill);
        mesh.renderOrder = 3;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), line);
        edges.renderOrder = 3;
        group.add(mesh, edges);
      }
      const lying = view.floor + 3;
      for (const route of view.routes) {
        const room = view.rooms.find((r) => r.componentId === route.from && r.end[0] === route.points[0]![0] && r.end[1] === route.points[0]![1]);
        const points = [
          ...(room ? [new THREE.Vector3(...room.end)] : []),
          ...route.points.map(([x, y]) => new THREE.Vector3(x, y, lying)),
        ];
        const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), line);
        path.renderOrder = 3;
        group.add(path);
      }
      this.wires = group;
      this.scene.add(group);
    }
    this.requestFrame();
  }

  setMeasuring(on: boolean) {
    this.measuring = on;
    this.measurePoints = [];
    this.drawMeasure();
    this.events.onMeasure([]);
  }

  private drawMeasure() {
    if (this.measureMarks) {
      this.measureMarks.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
      this.scene.remove(this.measureMarks);
      this.measureMarks = null;
    }
    if (this.measurePoints.length) {
      const group = new THREE.Group();
      const color = this.colors.selected;
      for (const point of this.measurePoints) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }));
        dot.position.set(...point);
        dot.renderOrder = 4;
        group.add(dot);
      }
      if (this.measurePoints.length === 2) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.measurePoints.map((p) => new THREE.Vector3(...p))), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
        line.renderOrder = 4;
        group.add(line);
      }
      this.measureMarks = group;
      this.scene.add(group);
    }
    this.requestFrame();
  }

  // Where a click lands on a part, pulled onto a corner of the face if one's close.
  private pickSurface(event: PointerEvent): [number, number, number] | null {
    this.rayFrom(event);
    const targets: THREE.Object3D[] = this.preview ? [this.preview] : [...[...this.parts.values()].filter((p) => p.mesh.visible).map((p) => p.mesh), ...(this.reference ? [this.reference] : [])];
    const hits = this.visibleHits(this.raycaster.intersectObjects(targets, true).filter((hit) => hit.object instanceof THREE.Mesh && hit.face && (hit.object.material as THREE.Material).side !== THREE.BackSide));
    const hit = hits[0];
    if (!hit || !hit.face) return null;
    const position = (hit.object as THREE.Mesh).geometry.getAttribute("position");
    const corners = [hit.face.a, hit.face.b, hit.face.c].map((i) => hit.object.localToWorld(new THREE.Vector3().fromBufferAttribute(position, i)));
    const nearest = corners.reduce((best, corner) => (corner.distanceTo(hit.point) < best.distanceTo(hit.point) ? corner : best));
    const point = nearest.distanceTo(hit.point) < SNAP_TO_CORNER ? nearest : hit.point;
    return [point.x, point.y, point.z];
  }

  setSection(section: Section | null) {
    if (section) {
      const { normal, constant } = sectionPlane(section);
      this.section = new THREE.Plane(new THREE.Vector3(...normal), constant);
    } else {
      this.section = null;
    }
    this.renderer.clippingPlanes = this.section ? [this.section] : [];
    this.showDesign();
  }

  // Keeps only what a section hasn't cut away, because a click can't reach those.
  private visibleHits(hits: THREE.Intersection[]) {
    return this.section ? hits.filter((hit) => this.section!.distanceToPoint(hit.point) >= 0) : hits;
  }

  private cutMaterialFor(color: string) {
    let material = this.cutMaterials.get(color);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
      this.cutMaterials.set(color, material);
    }
    return material;
  }

  setExplode(gap: number) {
    this.gap = gap;
    this.applyLayout();
    this.requestFrame();
  }

  setInternals(on: boolean) {
    this.internals = on;
    for (const material of this.partMaterials.values()) this.applySeeThrough(material);
    this.rebuildMarkers();
    this.showDesign();
  }

  setView(preset: ViewPreset) {
    this.fit(new THREE.Vector3(...PRESETS[preset]).normalize());
  }

  private partBounds() {
    const box = new THREE.Box3();
    if (this.preview) return box.expandByObject(this.preview);
    for (const { mesh } of this.parts.values()) box.expandByObject(mesh);
    return box;
  }

  private fit(direction: THREE.Vector3) {
    const box = this.partBounds();
    if (box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const fit = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) / Math.min(1, this.camera.aspect) * 1.05;
    this.camera.position.copy(centre).addScaledVector(direction, fit);
    this.controls.target.copy(centre);
    this.controls.update();
    this.requestFrame();
  }

  dispose() {
    this.fadedMaterial.dispose();
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // One material per part colour, so parts look like the plastic they'll print in.
  private materialFor(color: string) {
    let material = this.partMaterials.get(color);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      this.applySeeThrough(material);
      this.partMaterials.set(color, material);
    }
    return material;
  }

  private applySeeThrough(material: THREE.MeshStandardMaterial) {
    material.transparent = this.internals;
    material.opacity = this.internals ? 0.28 : 1;
    material.depthWrite = !this.internals;
    material.needsUpdate = true;
  }

  private countOf(kind: PartKind) {
    return this.partKinds.filter((k) => k === kind).length;
  }

  private offsetOf(printedPart: number) {
    return explodeOffset(printedPart, Math.max(this.countOf("shell"), 1), this.gap);
  }

  private applyLayout() {
    const shells = this.countOf("shell");
    const tops = this.countOf("top");
    for (const [index, { mesh, edges, cut }] of this.parts) {
      // Shell halves spread apart, the top lifts off, plates drop, the rail slides forward, and knobs come off.
      const kind = this.partKinds[index];
      let [x, y, z] = [0, 0, 0];
      if (kind === "shell") x = this.offsetOf(index);
      if (kind === "top") z = this.gap;
      if (kind === "plate") {
        x = explodeOffset(index - shells - tops, this.countOf("plate"), this.gap);
        z = -this.gap;
      }
      if (kind === "rail") {
        y = -this.gap;
        z = -this.gap / 2;
      }
      // Knobs lift off further than the top they sit on.
      if (kind === "knob") z = this.gap * 1.6;
      mesh.position.set(x, y, z);
      edges.position.set(x, y, z);
      cut.position.set(x, y, z);
    }
    for (const marker of this.markers) {
      if (marker.component.inWall) {
        marker.group.position.copy(this.wallFrame(marker.component).position);
        continue;
      }
      marker.group.position.x = this.markerX(marker.component);
      if (marker.component.mount === "panel") {
        const [, z] = surfacePoint(marker.component.surface!, marker.component.b, 0.15);
        marker.group.position.z = z + (marker.component.onTopPanel ? this.gap : 0);
      }
    }
    for (const { item, group } of this.fastenerMarkers) this.placeFastener(group, item, item.x, item.y);
  }

  // A plate screw's insert is in the shell, and a top screw's in its panel.
  private placeFastener(group: THREE.Group, item: PlannedFastener, x: number, y: number) {
    const shift = item.kind === "plate" ? this.offsetOf(this.shellAt(x)) : 0;
    group.position.set(x + shift, y, item.z + FASTENER_HEIGHT / 2 + (item.kind === "top" ? this.gap : 0));
  }

  private shellAt(x: number) {
    const seams = this.model?.seamXs ?? [];
    const index = seams.findIndex((seam) => x < seam);
    return index === -1 ? seams.length : index;
  }

  private buildFastener(item: PlannedFastener) {
    const view = this.fasteners!;
    const selected = item.id === view.selected;
    const color = item.problem ? this.colors.invalid : selected ? this.colors.selected : item.addedAt !== null ? this.colors.changed : this.colors.marker;
    const pick = new THREE.Mesh(
      new THREE.CylinderGeometry(FASTENER_DIAMETER / 2, FASTENER_DIAMETER / 2, FASTENER_HEIGHT, 24).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: selected ? 1 : 0.85, depthTest: false }),
    );
    pick.renderOrder = 2;
    const group = new THREE.Group();
    group.add(pick);
    this.placeFastener(group, item, item.x, item.y);
    this.markerRoot.add(group);
    return { item, group, pick };
  }

  private fastenerAt(event: PointerEvent) {
    this.rayFrom(event);
    // Markers rebuilt since the last frame haven't got their world positions yet.
    this.markerRoot.updateMatrixWorld(true);
    const hits = this.visibleHits(this.raycaster.intersectObjects(this.fastenerMarkers.map((m) => m.pick)));
    return this.fastenerMarkers.find((m) => m.pick === hits[0]?.object) ?? null;
  }

  // Where a pointer puts a screw: on its wall for a top screw, and for a plate screw anywhere
  // inside, pulling onto a wall's line when it's close.
  private fastenerSpot(item: PlannedFastener, ray: THREE.Ray, plane: THREE.Plane): [number, number] | null {
    const hit = ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    const model = this.model!;
    const last = model.surfaces.at(-1)?.y1 ?? 0;
    const shift = item.kind === "plate" ? this.offsetOf(this.shellAt(hit.x)) : 0;
    let x = THREE.MathUtils.clamp(hit.x - shift, 0, model.width);
    let y = THREE.MathUtils.clamp(hit.y, 0, last);
    const edges = this.fasteners?.edges.filter((edge) => edge.kind === item.kind && edge.surface === item.surface) ?? [];
    if (item.wall) {
      if (item.wall === "left" || item.wall === "right") x = item.x;
      else y = item.y;
      const onWall = edges.filter((edge) => edge.wall === item.wall);
      const along = item.wall === "left" || item.wall === "right" ? y : x;
      const nearest = onWall.reduce<FastenerEdge | null>((best, edge) => {
        const distance = (e: FastenerEdge) => Math.max(e.from - along, along - e.to, 0);
        return !best || distance(edge) < distance(best) ? edge : best;
      }, null);
      if (nearest) {
        const clamped = THREE.MathUtils.clamp(along, nearest.from, nearest.to);
        if (item.wall === "left" || item.wall === "right") y = clamped;
        else x = clamped;
      }
    } else {
      for (const edge of edges) {
        if (edge.along === "x" && Math.abs(y - edge.fixed) < SNAP_TO_WALL) y = edge.fixed;
        if (edge.along === "y" && Math.abs(x - edge.fixed) < SNAP_TO_WALL) x = edge.fixed;
      }
    }
    // Only what moves gets rounded, so a screw stays exactly on the line it's on.
    const onLine = (value: number) => edges.some((edge) => edge.fixed === value);
    const snapped = (value: number) => (onLine(value) ? value : Math.round(value / FASTENER_STEP) * FASTENER_STEP);
    return [snapped(x), snapped(y)];
  }

  private markerX(component: SceneComponent) {
    return component.a + (component.onTopPanel ? 0 : this.offsetOf(component.printedPart));
  }

  private rebuildMarkers() {
    for (const child of [...this.markerRoot.children]) {
      child.traverse((object) => {
        const disposable = object as THREE.Mesh;
        disposable.geometry?.dispose?.();
        (disposable.material as THREE.Material | undefined)?.dispose?.();
      });
      this.markerRoot.remove(child);
    }
    this.markers = [];
    this.fastenerMarkers = (this.fasteners?.items ?? []).map((item) => this.buildFastener(item));
    for (const component of this.model?.components ?? []) {
      if (component.mount === "floor" && !this.internals) continue;
      this.markers.push(this.buildMarker(component));
    }
    if (this.internals) {
      for (const box of this.model?.reserved ?? []) this.markerRoot.add(this.reservedBox(box));
    }
    this.requestFrame();
  }

  private colorFor(component: SceneComponent) {
    if (this.invalid.has(component.id)) return this.colors.invalid;
    return component.id === this.selected ? this.colors.selected : this.colors.marker;
  }

  private buildMarker(component: SceneComponent): Marker {
    const group = new THREE.Group();
    const color = this.colorFor(component);
    const emphasised = component.id === this.selected || this.invalid.has(component.id);
    const footprint = component.above ?? component.floor ?? component.inWall!.face;
    const flat = new THREE.ShapeGeometry(outlineShape(footprint), 32);
    const pick = new THREE.Mesh(
      flat,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: emphasised ? 0.3 : 0.08, depthWrite: false, side: THREE.DoubleSide }),
    );
    pick.userData.id = component.id;
    group.add(pick);
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(outlineShape(footprint).getPoints(32).map((p) => new THREE.Vector3(p.x, p.y, 0))),
      new THREE.LineBasicMaterial({ color, depthTest: !emphasised, transparent: true }),
    );
    group.add(outline);

    if (component.mount === "panel") {
      const surface = component.surface!;
      const [y, z] = surfacePoint(surface, component.b, 0.15);
      group.position.set(this.markerX(component), y, z + (component.onTopPanel ? this.gap : 0));
      group.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(0, surface.cos, surface.sin),
          new THREE.Vector3(0, -surface.sin, surface.cos),
        ),
      );
      if (this.internals) {
        const t = surface.thickness;
        if (component.above!.height > 0) group.add(this.bodyMesh(component.above!, 0, component.above!.height, color));
        if (component.below!.depth > 0) group.add(this.bodyMesh(component.below!, -t - component.below!.depth, -t, color));
      }
    } else if (component.inWall) {
      const { wall, body, depth } = component.inWall;
      const { position, along, outward } = this.wallFrame(component);
      group.position.copy(position);
      group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, new THREE.Vector3(0, 0, 1), outward));
      const thick = this.model!.wall;
      if (this.internals && wall) group.add(this.bodyMesh(body, -thick - depth, -thick, color));
    } else {
      const floorTop = this.model!.floorThickness;
      group.position.set(this.markerX(component), component.b, floorTop + 0.1);
      group.add(this.bodyMesh(component.floor!, 0, component.floor!.height, color));
    }
    this.markerRoot.add(group);
    return { component, group, pick };
  }

  // Where a part in a wall is, a little outside it, and which ways its marker runs. x reads along
  // the wall from outside.
  private wallFrame(component: SceneComponent) {
    const { wall } = component.inWall!;
    const model = this.model!;
    const depth = model.surfaces.at(-1)?.y1 ?? 0;
    const lift = 0.15;
    const shift = this.offsetOf(component.printedPart);
    if (wall === "front") return { position: new THREE.Vector3(component.a + shift, -lift, component.b), along: new THREE.Vector3(1, 0, 0), outward: new THREE.Vector3(0, -1, 0) };
    if (wall === "rear") return { position: new THREE.Vector3(component.a + shift, depth + lift, component.b), along: new THREE.Vector3(-1, 0, 0), outward: new THREE.Vector3(0, 1, 0) };
    if (wall === "left") return { position: new THREE.Vector3(-lift + shift, component.a, component.b), along: new THREE.Vector3(0, -1, 0), outward: new THREE.Vector3(-1, 0, 0) };
    return { position: new THREE.Vector3(model.width + lift + shift, component.a, component.b), along: new THREE.Vector3(0, 1, 0), outward: new THREE.Vector3(1, 0, 0) };
  }

  private reservedBox({ xMin, xMax, yMin, yMax, top }: SceneModel["reserved"][number]) {
    const geometry = new THREE.BoxGeometry(xMax - xMin, yMax - yMin, top);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: this.colors.marker, transparent: true, opacity: 0.12, depthWrite: false }));
    mesh.position.set((xMin + xMax) / 2, (yMin + yMax) / 2, top / 2);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: this.colors.marker, transparent: true, opacity: 0.5 })));
    return mesh;
  }

  private bodyMesh(box: Box2, fromZ: number, toZ: number, color: string) {
    const height = toZ - fromZ;
    const geometry =
      box.shape === "circle"
        ? new THREE.CylinderGeometry(box.hu, box.hu, height, 32).rotateX(Math.PI / 2)
        : new THREE.BoxGeometry(box.hu * 2, box.hv * 2, height);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.55, roughness: 0.8, depthWrite: false }));
    mesh.position.z = (fromZ + toZ) / 2;
    return mesh;
  }

  private rayFrom(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    return this.raycaster.ray;
  }

  private markerAt(event: PointerEvent): Marker | null {
    if (this.fasteners) return null;
    this.rayFrom(event);
    const hits = this.visibleHits(this.raycaster.intersectObjects(this.markers.map((m) => m.pick)));
    if (hits.length === 0) return null;
    // The shell hides what's behind it, unless it's see-through.
    if (!this.internals) {
      const shell = this.visibleHits(this.raycaster.intersectObjects([...this.parts.values()].map((p) => p.mesh)));
      if (shell[0] && shell[0].distance < hits[0]!.distance - 1) return null;
    }
    return this.markers.find((m) => m.pick === hits[0]!.object) ?? null;
  }

  private planeFor(component: SceneComponent): THREE.Plane {
    if (component.inWall) {
      const { position, outward } = this.wallFrame(component);
      return new THREE.Plane().setFromNormalAndCoplanarPoint(outward, position);
    }
    if (component.mount === "floor") {
      return new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, this.model!.floorThickness));
    }
    const s = component.surface!;
    const lift = component.onTopPanel ? this.gap : 0;
    return new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, -s.sin, s.cos), new THREE.Vector3(0, s.y0, s.z0 + lift));
  }

  // Where a ray meets a component's plane, as (u, v) or (x, y), ignoring any separation.
  private planePosition(ray: THREE.Ray, plane: THREE.Plane, component: SceneComponent): [number, number] | null {
    // On a curve, it follows the curve itself, since its own flat moves and turns with it.
    if (component.curve && this.model) {
      const shift = this.offsetOf(component.printedPart);
      const on = curveCoordinates(this.model.surfaces, component.curve, [ray.origin.x - shift, ray.origin.y, ray.origin.z], [ray.direction.x, ray.direction.y, ray.direction.z]);
      if (on) return [on.u, on.v];
    }
    const hit = ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    const x = hit.x - (component.onTopPanel ? 0 : this.offsetOf(component.printedPart));
    if (component.inWall) return [component.inWall.wall === "left" || component.inWall.wall === "right" ? hit.y : x, hit.z];
    if (component.mount === "floor") return [x, hit.y];
    const { u, v } = surfaceCoordinates(component.surface!, [x, hit.y, hit.z - (component.onTopPanel ? this.gap : 0)]);
    return [u, v];
  }

  private handleDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (this.measuring) {
      this.pressedEmpty = { x: event.clientX, y: event.clientY };
      return;
    }
    if (this.preview) return;
    if (this.fasteners) {
      const fastener = this.fastenerAt(event);
      if (!fastener) {
        this.pressedEmpty = { x: event.clientX, y: event.clientY };
        return;
      }
      this.pressedEmpty = null;
      event.stopImmediatePropagation();
      const { item } = fastener;
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), fastener.group.position);
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(event.pointerId);
      this.fastenerDrag = { item, plane, x: item.x, y: item.y, moved: false };
      this.events.onFastenerSelect(item.id);
      return;
    }
    const marker = this.markerAt(event);
    if (!marker) {
      this.pressedEmpty = { x: event.clientX, y: event.clientY };
      return;
    }
    this.pressedEmpty = null;
    event.stopImmediatePropagation();
    const plane = this.planeFor(marker.component);
    const at = this.planePosition(this.raycaster.ray, plane, marker.component);
    if (!at) return;
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.drag = {
      id: marker.component.id,
      plane,
      offset: [marker.component.a - at[0], marker.component.b - at[1]],
      surface: marker.component.surface,
      moved: false,
    };
    this.events.onSelect(marker.component.id);
    this.events.onDragStart(marker.component.id);
  };

  private pressedEmpty: { x: number; y: number } | null = null;

  private handleMove = (event: PointerEvent) => {
    if (this.preview || this.measuring) return;
    if (this.fastenerDrag) {
      const { item, plane } = this.fastenerDrag;
      const spot = this.fastenerSpot(item, this.rayFrom(event), plane);
      if (!spot || (spot[0] === this.fastenerDrag.x && spot[1] === this.fastenerDrag.y)) return;
      this.fastenerDrag.moved = true;
      [this.fastenerDrag.x, this.fastenerDrag.y] = spot;
      this.renderer.domElement.style.cursor = "grabbing";
      const marker = this.fastenerMarkers.find((m) => m.item.id === item.id);
      if (marker) this.placeFastener(marker.group, item, spot[0], spot[1]);
      this.events.onFastenerDrag(item.id, spot[0], spot[1]);
      this.requestFrame();
      return;
    }
    if (this.fasteners) {
      this.renderer.domElement.style.cursor = this.fastenerAt(event) ? "grab" : "";
      return;
    }
    if (!this.drag) {
      this.renderer.domElement.style.cursor = this.markerAt(event) ? "grab" : "";
      return;
    }
    const component = this.model?.components.find((c) => c.id === this.drag!.id);
    if (!component) return;
    const at = this.planePosition(this.rayFrom(event), this.drag.plane, component);
    if (!at) return;
    this.drag.moved = true;
    this.renderer.domElement.style.cursor = "grabbing";
    const [a, b] = this.clampToEnclosure(component, at[0] + this.drag.offset[0], at[1] + this.drag.offset[1]);
    this.events.onDrag(this.drag.id, a, b);
  };

  // At a grazing angle, a small pointer move can hit the plane very far away. Keep the
  // part close enough to the enclosure to stay on screen and be dragged back.
  private clampToEnclosure(component: SceneComponent, a: number, b: number): [number, number] {
    const model = this.model!;
    const REACH = 30;
    const last = model.surfaces.at(-1);
    const along = component.curve ? model.surfaces.filter((s) => s.curveOf === component.curve).reduce((sum, s) => sum + s.length, 0) : component.surface?.length;
    const bLimit = along ?? last?.y1 ?? 0;
    return [THREE.MathUtils.clamp(a, -REACH, model.width + REACH), THREE.MathUtils.clamp(b, -REACH, bLimit + REACH)];
  }

  private handleUp = (event: PointerEvent) => {
    if (this.fastenerDrag) {
      const { item, x, y, moved } = this.fastenerDrag;
      this.fastenerDrag = null;
      this.controls.enabled = true;
      this.renderer.domElement.style.cursor = "";
      if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
      if (moved) this.events.onFastenerDrop(item.id, x, y);
      else this.rebuildMarkers();
      return;
    }
    if (this.drag) {
      const { id } = this.drag;
      this.drag = null;
      this.controls.enabled = true;
      this.renderer.domElement.style.cursor = "";
      if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
      this.events.onDragEnd(id);
      return;
    }
    // A click on empty space deselects, but the end of an orbit shouldn't.
    if (this.measuring) {
      if (this.pressedEmpty && Math.hypot(event.clientX - this.pressedEmpty.x, event.clientY - this.pressedEmpty.y) < 4) {
        const point = this.pickSurface(event);
        if (point) {
          this.measurePoints = this.measurePoints.length >= 2 ? [point] : [...this.measurePoints, point];
          this.drawMeasure();
          this.events.onMeasure(this.measurePoints);
        }
      }
      this.pressedEmpty = null;
      return;
    }
    if (this.pressedEmpty && Math.hypot(event.clientX - this.pressedEmpty.x, event.clientY - this.pressedEmpty.y) < 4) {
      if (this.fasteners) this.events.onFastenerSelect(null);
      else this.events.onSelect(null);
    }
    this.pressedEmpty = null;
  };

  private resize() {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  private requestFrame() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.renderer.render(this.scene, this.camera);
    });
  }
}
