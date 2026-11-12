import { hex } from "../pins.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dialDeck from "../../examples/dial-deck.json";
import deskSynth from "../../examples/desk-synth.json";
import type { Part } from "../schema.js";
import type { FitTestPlan } from "../fitTest.js";
import { validateConfig, type Issue, type PlannedFasteners } from "../validate.js";
import { designFromHash, designHash } from "./shareLink.js";
import { addComponent, setCap, setKnob, formatConfig, parseConfig, partsOf, removeComponent, updateComponent, type RawConfig } from "./configEdit.js";
import { describeEstimate, WIRE_SLACK_NOTE, wireLength, type PartPrintReport } from "../printing.js";
import { EngineClient, type BedView, type BuildResult, type FitTestMesh } from "./engineClient.js";
import { moveFastener, removeFastener } from "./fastenerEdit.js";
import { loadHistory, saveHistory, type DesignHistory } from "./designHistory.js";
import { FitTestPanel } from "./FitTestPanel.js";
import { labelOfComponent, setComponentLabel, type LabelSide } from "./labelEdit.js";
import { NumberField, TextField } from "./fields.js";
import { LayoutTools } from "./LayoutTools.js";
import { PartForm } from "./PartForm.js";
import { PrintCost } from "./PrintCost.js";
import { loadPrinted, markPrinted, reprintStatus, savePrinted, type PrintedRecord } from "./reprint.js";
import { applyProfile, loadProfile } from "./printerProfile.js";
import { Scene3D, type PickedFace, type SceneColors, type ViewPreset } from "./Scene3D.js";
import { buildSceneModel, fieldSpot, issueSpot, measureBetween, nearestNeighbour, sectionRange, snap, type SectionAxis } from "./sceneModel.js";
import { ScrewsPanel } from "./ScrewsPanel.js";
import { VersionsPanel } from "./VersionsPanel.js";
import { ShapePanel } from "./ShapePanel.js";
import { ontoAnotherSurface, ontoWords, placingPart, spotFor, type Placing } from "./placeEdit.js";
import { spotAt } from "./pickSpot.js";
import { describeThing, FASTENER_PREFIX, nameOfThing, partOfLabel, thingAt, type PickExtras } from "./pickThing.js";
import { menuFor, type MenuChoice, type MenuTarget } from "./viewMenu.js";
import { ArrayMenuForm } from "./ArrayMenuForm.js";
import { handlesFor, type HandleSpec } from "./shapeHandles.js";
import { facingFor } from "./lookAt.js";
import { guideSegments, snapDrag } from "./snap.js";
import { centreOf, dimensionsFor, placeForDimension, type Side } from "./dimensions.js";
import { reachCells, refusedSquares, type Cell } from "./reach.js";
import { firstUnfinished, TUTORIAL, tutorialStart, type TutorialState } from "./tutorial.js";
import { TutorialPanel } from "./TutorialPanel.js";
import { copyParts, duplicateComponent, duplicateThing, nearestFit, nudgeThing, pasteParts, removeThing, rotateThing } from "./thingKeys.js";
import { bedsFor, describeBed } from "../bedLayout.js";
import { ReferencePanel, type LoadedReference } from "./ReferencePanel.js";
import { referenceMiddle, referenceTransform, startingPlace } from "../reference.js";
import type { ReferenceMesh } from "./engineClient.js";
import { addCustomPart, draftFromPart, newPartDraft, removeCustomPart, updateCustomPart } from "./shapeEdit.js";
import { TEMPLATES } from "./templates.js";
import { lineUpGroup, spaceEvenly } from "./layoutEdit.js";

const PART_DRAG = "application/x-enclosure-part"; // a library part being dragged onto the view

const DRAFT_KEY = "enclosure-generator.draft-v3";
const STEP_GAP = 30; // how far apart an assembly step separates the parts
const HISTORY_LIMIT = 100;

const exampleText = formatConfig(deskSynth as RawConfig);
const EXAMPLES: Record<string, string> = {
  "Desk Synth": exampleText,
  "Dial deck": formatConfig(dialDeck as RawConfig),
};

function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? exampleText;
  } catch {
    return exampleText;
  }
}

function saveDraft(text: string) {
  try {
    localStorage.setItem(DRAFT_KEY, text);
  } catch {
    // Without storage the draft just won't survive a reload.
  }
}

function readColors(): SceneColors {
  const style = getComputedStyle(document.documentElement);
  const get = (name: string) => style.getPropertyValue(name).trim();
  return {
    background: get("--viewport"),
    shell: get("--shell"),
    shellAlt: get("--shell-alt"),
    edge: get("--edge"),
    marker: get("--marker"),
    wire: get("--wire"),
    selected: get("--accent"),
    invalid: get("--danger"),
    changed: get("--changed"),
    steep: get("--warning"),
  };
}

function download(bytes: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

type Tab = "shape" | "layout" | "screws" | "config" | "print";

export function App() {
  const [text, setText] = useState(loadDraft);
  const [selected, setSelected] = useState<string | null>(null);
  // Parts selected along with it, by Shift-clicking them, to move, line up or delete together.
  const [group, setGroup] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("layout");
  const [internals, setInternals] = useState(false);
  const [showWires, setShowWires] = useState(false);
  const [gap, setGap] = useState(0);
  const [busy, setBusy] = useState(false);
  const [lastBuild, setLastBuild] = useState<(BuildResult & { shownMs: number }) | null>(null);
  const [engineProblem, setEngineProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [partToAdd, setPartToAdd] = useState("arcade-24mm");
  const [canUndo, setCanUndo] = useState(() => loadHistory(loadDraft()).past.length > 0);
  const [canRedo, setCanRedo] = useState(() => loadHistory(loadDraft()).future.length > 0);
  // Which custom part is being edited, with null as the id for a new one.
  const [partEditor, setPartEditor] = useState<{ id: string | null } | null>(null);
  const [selectedFastener, setSelectedFastener] = useState<string | null>(null);
  const [dragProblem, setDragProblem] = useState<string | null>(null);
  const [fitPreview, setFitPreview] = useState<FitTestMesh[] | null>(null);
  const [printReports, setPrintReports] = useState<PartPrintReport[]>([]);
  const [shownIssue, setShownIssue] = useState<Issue | null>(null);
  const [measuring, setMeasuring] = useState(false);
  // Something waiting to be put where the next click in the view lands.
  const [placing, setPlacing] = useState<Placing | null>(null);
  // Bumped when the view turns, so that what's drawn over it is placed again.
  const [, setViewTick] = useState(0);
  const [editingSide, setEditingSide] = useState<Side | null>(null);
  // The tutorial: which step it's on, whether it's finished, and whether the files were downloaded in it.
  const [tutorial, setTutorial] = useState<{ step: number; finished: boolean; exported: boolean } | null>(null);
  const [selectBox, setSelectBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  useEffect(() => setEditingSide(null), [selected]);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; title: string; choices: MenuChoice[]; array?: { part: string } | { path: string } } | null>(null);
  const [placingMissed, setPlacingMissed] = useState(false);
  // What was last clicked in the view or focused in the Shape tab, other than a part, as its path
  // in the config. Its fields are shown, and it's lit up in the view.
  const [picked, setPicked] = useState<string | null>(null);
  const [reference, setReference] = useState<(LoadedReference & { mesh: ReferenceMesh }) | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceProblem, setReferenceProblem] = useState<string | null>(null);
  const [measured, setMeasured] = useState<[number, number, number][]>([]);
  const [printed, setPrinted] = useState<PrintedRecord>(loadPrinted);
  const [sectionAxis, setSectionAxis] = useState<SectionAxis | null>(null);
  const [sectionShare, setSectionShare] = useState(0.5); // how far along, so that it keeps its place as the design changes
  const [bedPart, setBedPart] = useState<{ index: number; view: BedView } | null>(null);

  const history = useRef<DesignHistory>(loadHistory(text));
  const committed = useRef(text);
  const openInput = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  const toggleRef = useRef<(id: string) => void>(() => {});
  const lookRef = useRef<() => void>(() => {});
  // Where the selected part can't go, worked out a little at a time, and shaded while it's dragged.
  const dragging = useRef<string | null>(null);
  const reach = useRef<{ key: string; id: string; cells: Cell[] }>({ key: "", id: "", cells: [] });
  const showReach = () => {
    const { model: scene3d } = latest.current;
    const id = dragging.current;
    if (!id || !scene3d || reach.current.id !== id) return;
    sceneRef.current?.setShading(refusedSquares(scene3d, id, reach.current.cells));
  };
  // Whether Alt is held, which drags without snapping.
  const altHeld = useRef(false);
  useEffect(() => {
    const track = (event: KeyboardEvent) => (altHeld.current = event.altKey);
    const reset = () => (altHeld.current = false);
    window.addEventListener("keydown", track);
    window.addEventListener("keyup", track);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", track);
      window.removeEventListener("keyup", track);
      window.removeEventListener("blur", reset);
    };
  }, []);
  const engineRef = useRef<EngineClient | null>(null);

  const parsed = useMemo(() => parseConfig(text), [text]);
  const lastGood = useRef<RawConfig>(deskSynth as RawConfig);
  if (parsed.ok) lastGood.current = parsed.config;
  const config = lastGood.current;

  const result = useMemo(() => (parsed.ok ? validateConfig(parsed.config) : null), [parsed]);
  const errors: Issue[] = result && !result.ok ? result.errors : [];
  const warnings: Issue[] = result?.warnings ?? [];
  // Kept through problems, so that a screw in a bad spot can still be seen and moved.
  const lastFasteners = useRef<PlannedFasteners>({ items: [], edges: [] });
  const planned = result?.ok ? result.plan.fasteners : result?.fasteners;
  if (planned) lastFasteners.current = planned;
  const fasteners = lastFasteners.current;
  const seeThrough = internals || tab === "screws";
  const model = useMemo(() => buildSceneModel(config), [config]);
  const invalid = useMemo(() => new Set(errors.flatMap((e) => e.componentIds)), [errors]);
  const parts = useMemo(() => partsOf(config), [config]);
  const components: any[] = Array.isArray(config.components) ? config.components : [];
  const selectedComponent = components.find((c) => c.id === selected);
  const selectedPart = selectedComponent ? parts[selectedComponent.type] : undefined;
  const surfaceIds: string[] = (config.enclosure?.surfaces ?? []).map((s: any) => s.id);
  // Another design may not have the custom part that was chosen.
  const chosenPart = parts[partToAdd] ? partToAdd : "arcade-24mm";
  const customParts: Record<string, unknown> = config.customParts ?? {};

  const commit = useCallback((next: string) => {
    if (next === committed.current) return;
    history.current.past = [...history.current.past, committed.current].slice(-HISTORY_LIMIT);
    history.current.future = [];
    committed.current = next;
    setCanUndo(true);
    setCanRedo(false);
    saveDraft(next);
    saveHistory(history.current, next);
  }, []);

  const applyConfig = useCallback(
    (next: RawConfig, record = true) => {
      const nextText = formatConfig(next);
      setText(nextText);
      if (record) commit(nextText);
    },
    [commit],
  );

  const restore = useCallback((direction: "undo" | "redo") => {
    const { past, future } = history.current;
    const from = direction === "undo" ? past : future;
    const target = from[from.length - 1];
    if (target === undefined) return;
    if (direction === "undo") {
      history.current = { past: past.slice(0, -1), future: [...future, committed.current] };
    } else {
      history.current = { past: [...past, committed.current], future: future.slice(0, -1) };
    }
    committed.current = target;
    setText(target);
    saveDraft(target);
    saveHistory(history.current, target);
    setCanUndo(history.current.past.length > 0);
    setCanRedo(history.current.future.length > 0);
  }, []);

  // Dragging reads the latest state through a ref, because the scene's callbacks are
  // set once. Each move replaces the text, and only the release joins the undo history.
  const plan = result?.ok ? result.plan : null;
  const latest = useRef({ config, applyConfig, model, text, commit, fasteners, placing, seeThrough, tab: tab as string, picked, plan, selected, group });
  latest.current = { config, applyConfig, model, text, commit, fasteners, placing, seeThrough, tab, picked, plan, selected, group };

  useEffect(() => {
    // Shift-click: in or out of what's selected. The first one stays the one the rest line up with.
    const toggleInGroup = (id: string) => {
      const { selected: first, group: others } = latest.current;
      if (first === id) {
        setSelected(others[0] ?? null);
        setGroup(others.slice(1));
      } else if (others.includes(id)) setGroup(others.filter((other) => other !== id));
      else if (!first) setSelected(id);
      else setGroup([...others, id]);
      setPicked(null);
      setTab("layout");
    };
    toggleRef.current = toggleInGroup;
    // What's under a click, with what the validator worked out: where labels went, the screws and
    // the plate's joints.
    const whatsAt = (faces: PickedFace[]) => {
      const { config: current, model: scene3d, seeThrough: through, plan } = latest.current;
      const spots = faces.map((face) => (scene3d ? spotAt(scene3d, face.point, face.normal) : null));
      const extras: PickExtras = {
        points: faces.map((face) => face.point),
        fasteners: latest.current.fasteners.items,
        ...(plan && { labels: plan.labels, plateJoints: plan.plate?.joints ?? [] }),
        ...(scene3d && { floorThickness: scene3d.floorThickness }),
      };
      return { path: thingAt(current, spots, through, extras), spots };
    };
    // Selects it where its fields are: a screw on the Screws tab, a part's own label as its part on
    // the Layout tab, and the rest on the Shape tab.
    const selectThing = (path: string) => {
      const owner = partOfLabel(latest.current.config, path);
      if (path.startsWith(FASTENER_PREFIX)) {
        setPicked(null);
        setTab("screws");
        setSelectedFastener(path.slice(FASTENER_PREFIX.length));
      } else if (owner) {
        setPicked(null);
        setTab("layout");
        setSelected(owner);
      } else {
        setSelected(null);
        setPicked(path);
        setTab("shape");
      }
    };
    const scene = new Scene3D(
      viewportRef.current!,
      {
        onSelect: (id) => {
          setSelected(id);
          setGroup([]);
        },
        onToggle: (id) => toggleInGroup(id),
        onDragStart: (id) => {
          dragging.current = id;
          showReach();
        },
        onDrag: (id, a, b) => {
          const { config: current, applyConfig: apply, model: scene3d } = latest.current;
          const mount = scene3d?.components.find((c) => c.id === id)?.mount;
          const step = 0.5;
          // Into line with what's near, unless Alt is held, with guides for the lines it's on.
          const snapped = scene3d && !altHeld.current ? snapDrag(scene3d, id, a, b) : { a: snap(a, step), b: snap(b, step), guides: [] };
          sceneRef.current?.setGuides(scene3d ? guideSegments(scene3d, id, snapped.guides) : []);
          const patch = mount === "wall" ? { at: snapped.a, z: snapped.b } : mount === "floor" ? { x: snapped.a, y: snapped.b } : { u: snapped.a, v: snapped.b };
          apply(updateComponent(current, id, patch), false);
        },
        onDragEnd: () => {
          dragging.current = null;
          sceneRef.current?.setShading([]);
          sceneRef.current?.setGuides([]);
          latest.current.commit(latest.current.text);
        },
        onHandleDrag: (id, delta, deltaAcross) => {
          const spec = handleSpecs.current.find((h) => h.id === id);
          if (!spec) return;
          handleBase.current ??= latest.current.config;
          latest.current.applyConfig(spec.apply(handleBase.current, delta, deltaAcross), false);
        },
        onLook: () => lookRef.current(),
        onViewChange: () => setViewTick((n) => n + 1),
        onBox: (box, done) => {
          if (!done) return setSelectBox(box);
          setSelectBox(null);
          const { model: scene3d, seeThrough: through } = latest.current;
          if (!box || !scene3d) return;
          const [left, right, top, bottom] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1), Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)];
          // Parts on the floor are only seen, and so only boxed, with the inside showing.
          const inside = scene3d.components.filter((c) => {
            if (c.mount === "floor" && !through) return false;
            const centre = centreOf(scene3d, c);
            const at = centre && sceneRef.current?.project(centre);
            return at && at.x >= left && at.x <= right && at.y >= top && at.y <= bottom;
          });
          if (!inside.length) return;
          setSelected(inside[0]!.id);
          setGroup(inside.slice(1).map((c) => c.id));
          setPicked(null);
          setTab("layout");
        },
        onHover: (at, part, faces) => {
          if (!at) return setHover(null);
          const { config: current } = latest.current;
          const path = part ? `components:${part}` : whatsAt(faces).path;
          const names = Object.fromEntries(Object.entries(partsOf(current)).map(([type, p]) => [type, p.name]));
          const text = path ? describeThing(current, path, names) : null;
          setHover(text ? { x: at.x, y: at.y, text } : null);
        },
        onHandleEnd: () => {
          if (!handleBase.current) return;
          handleBase.current = null;
          latest.current.commit(latest.current.text);
          setHandlesDropped((n) => n + 1);
        },
        onDragOnto: (id, faces) => {
          const { config: current, applyConfig: apply, model: scene3d } = latest.current;
          const component = scene3d?.components.find((c) => c.id === id);
          if (!scene3d || !component) return false;
          const next = ontoAnotherSurface(current, id, component.curve ?? component.surface?.id ?? null, faces.map((face) => spotAt(scene3d, face.point, face.normal)));
          if (next) apply(next, false);
          return next !== null;
        },
        onMeasure: setMeasured,
        onClick: (faces) => {
          const { model: scene3d, tab: on } = latest.current;
          if (!scene3d || (on !== "shape" && on !== "layout")) return;
          const { path } = whatsAt(faces);
          // From the Layout tab, where a click on the model is how a part is let go of, only
          // something in particular is worth leaving for, not the bare surface or wall.
          const bare = path !== null && /^enclosure\./.test(path);
          const wanted = on === "layout" && bare ? null : path;
          if (wanted) selectThing(wanted);
          else setPicked(null);
        },
        onMenu: (at, part, faces) => {
          const { config: current, model: scene3d } = latest.current;
          setMenu(null);
          if (!scene3d) return;
          let target: MenuTarget | null = null;
          let title = "";
          if (part) {
            target = { part };
            title = part;
            setSelected(part);
          } else {
            const { path, spots } = whatsAt(faces);
            const spot = spots.find((s) => s !== null);
            // A part's own label stands for its part, and a screw has only its removal.
            const owner = path ? partOfLabel(current, path) : null;
            const screw = path?.startsWith(FASTENER_PREFIX) ? latest.current.fasteners.items.find((f) => `${FASTENER_PREFIX}${f.id}` === path) : undefined;
            if (path) selectThing(path);
            if (owner) {
              target = { part: owner };
              title = owner;
            } else if (screw) {
              return setMenu({ x: at.x, y: at.y, title: "The screw", choices: [{ label: "Delete", danger: true, run: (c) => ({ config: removeFastener(c, screw) }) }] });
            } else if (path && !/^enclosure\./.test(path) && menuFor(current, { path }).length) {
              target = { path };
              title = `The ${nameOfThing(path)}`;
            } else if (spot) {
              target = { spot };
              title = spot.kind === "surface" ? `On ${spot.surface}` : spot.kind === "wall" ? `On the ${spot.wall} wall` : spot.kind === "floor" ? "On the floor inside" : "On the underside";
            }
          }
          if (!target) return;
          // Each surface's length, a curve's flats together, for moving a part onto it.
          const lengths: Record<string, number> = {};
          for (const s of scene3d.surfaces) lengths[s.curveOf ?? s.id] = (lengths[s.curveOf ?? s.id] ?? 0) + s.length;
          const choices = menuFor(current, target, lengths);
          if (choices.length) setMenu({ x: at.x, y: at.y, title, choices });
        },
        onPick: (faces) => {
          const { config: current, applyConfig: apply, model: scene3d, placing: waiting } = latest.current;
          if (!waiting || !scene3d) return;
          const spot = spotFor(waiting, faces.map((face) => spotAt(scene3d, face.point, face.normal)));
          if (!spot) return setPlacingMissed(true);
          apply(waiting.at(current, spot));
          if (waiting.selects) setSelected(waiting.selects);
          setPlacing(null);
        },
        onFastenerSelect: setSelectedFastener,
        onFastenerDrag: (id, x, y) => {
          // Checked as it goes, without changing the design until it's dropped.
          const { config: current, fasteners: planned } = latest.current;
          const item = planned.items.find((f) => f.id === id);
          if (!item) return;
          const moved = moveFastener(current, item, x, y);
          const check = validateConfig(moved.config, { wiring: false });
          const now = (check.ok ? check.plan.fasteners : check.fasteners)?.items.find((f) => f.id === moved.id);
          setDragProblem(now?.problem ?? null);
          scene.setFastenerDragProblem(Boolean(now?.problem));
        },
        onFastenerDrop: (id, x, y) => {
          const { config: current, applyConfig: apply, fasteners: planned } = latest.current;
          const item = planned.items.find((f) => f.id === id);
          setDragProblem(null);
          if (!item) return;
          const moved = moveFastener(current, item, x, y);
          apply(moved.config);
          setSelectedFastener(moved.id);
        },
      },
      readColors(),
    );
    sceneRef.current = scene;
    const engine = new EngineClient({
      onBuilt: (build, submittedAt) => {
        scene.setParts(build.meshes, build.partKinds, build.partColors);
        requestAnimationFrame(() => {
          setLastBuild({ ...build, shownMs: performance.now() - submittedAt });
          setEngineProblem(null);
        });
      },
      onBusy: setBusy,
      onFailure: setEngineProblem,
      onRestart: (reason) => {
        console.info(`Engine restarted: ${reason}`);
        if (reason === "failure") setNotice("The engine hit a problem and restarted.");
      },
    });
    engineRef.current = engine;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const recolor = () => scene.setColors(readColors());
    media.addEventListener("change", recolor);
    return () => {
      media.removeEventListener("change", recolor);
      engine.dispose();
      scene.dispose();
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setModel(model, selected, invalid, new Set(group));
  }, [model, selected, invalid, seeThrough, group]);

  useEffect(() => {
    sceneRef.current?.setInternals(seeThrough);
    sceneRef.current?.setModel(model, selected, invalid, new Set(group));
  }, [seeThrough]); // eslint-disable-line react-hooks/exhaustive-deps

  // The rest go when nothing's selected, and any that are no longer in the design.
  useEffect(() => {
    const present = new Set((config.components ?? []).map((c: RawConfig) => c.id));
    setGroup((others) => {
      const kept = selected ? others.filter((id) => id !== selected && present.has(id)) : [];
      return kept.length === others.length ? others : kept;
    });
  }, [selected, config]);

  useEffect(() => {
    sceneRef.current?.setFasteners(tab === "screws" ? { ...fasteners, selected: selectedFastener } : null);
  }, [tab, fasteners, selectedFastener]);

  // Only for a valid design, since rooms and routes come from its plan.
  const wiring = result?.ok ? result.plan.wiring : null;
  const floorTop = result?.ok ? result.plan.config.enclosure.floorThickness : 0;
  useEffect(() => {
    sceneRef.current?.setWires(showWires && wiring ? { ...wiring, floor: floorTop } : null);
  }, [showWires, wiring, floorTop]);

  useEffect(() => {
    sceneRef.current?.setPreview(fitPreview);
  }, [fitPreview]);

  // The mark comes off as soon as the design changes, since it may no longer be right.
  useEffect(() => {
    setShownIssue(null);
  }, [text]);

  useEffect(() => {
    const spot = shownIssue && model ? issueSpot(shownIssue, config, model, fasteners) : null;
    sceneRef.current?.setHighlight(spot);
  }, [shownIssue]); // eslint-disable-line react-hooks/exhaustive-deps

  // A part and something else aren't both selected.
  useEffect(() => {
    if (selected) setPicked(null);
  }, [selected]);

  // Handles to drag for what's picked on the Shape tab. They stay as they were while one is dragged,
  // since each changes the design from what it was when the drag began.
  const handleSpecs = useRef<HandleSpec[]>([]);
  const handleBase = useRef<RawConfig | null>(null);
  const [handlesDropped, setHandlesDropped] = useState(0);
  useEffect(() => {
    if (handleBase.current) return;
    handleSpecs.current = tab === "shape" && valid ? handlesFor(config, picked, plan?.plate?.joints ?? [], model ?? undefined) : [];
    sceneRef.current?.setHandles(handleSpecs.current);
  }, [picked, text, tab, handlesDropped]); // eslint-disable-line react-hooks/exhaustive-deps

  // What's picked is lit up where it is now, so it follows as its numbers change, or just the part
  // of it one number sizes while that number's field has the cursor.
  const [focusedField, setFocusedField] = useState<string | null>(null);
  useEffect(() => {
    if (picked === null && focusedField === null && shownIssue) return;
    const field = focusedField && model ? fieldSpot(focusedField, config, model) : null;
    sceneRef.current?.setHighlight(field ?? (picked && model ? issueSpot({ path: picked }, config, model, fasteners) : null), "selection");
  }, [picked, text, focusedField]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    sceneRef.current?.setMeasuring(measuring);
  }, [measuring]);

  useEffect(() => {
    sceneRef.current?.setPicking(placing !== null);
    setPlacingMissed(false);
    if (placing) setMeasuring(false);
  }, [placing]);

  useEffect(() => {
    if (!reference) {
      sceneRef.current?.setReference(null);
      return;
    }
    const { matrix, offset } = referenceTransform(reference.bounds, reference.place);
    sceneRef.current?.setReference({ mesh: reference.mesh, middle: referenceMiddle(reference.bounds), matrix, offset });
  }, [reference]);

  const openReference = async (file: File) => {
    const engine = engineRef.current;
    if (!engine) return;
    setReferenceLoading(true);
    setReferenceProblem(null);
    try {
      const mesh = await engine.importReference(await file.arrayBuffer());
      const plan = result?.ok ? result.plan : null;
      const place = startingPlace(plan?.config.enclosure.width ?? 0, plan?.profile.depth ?? 0, plan?.config.enclosure.floorThickness ?? 0);
      setReference({ name: file.name, bounds: mesh.bounds, place, mesh });
    } catch (error) {
      setReferenceProblem(`That file couldn't be read as a STEP model: ${(error as Error).message}`);
    } finally {
      setReferenceLoading(false);
    }
  };

  const sectionSpan = model && sectionAxis ? sectionRange(model, sectionAxis) : null;
  const sectionAt = sectionSpan ? sectionSpan[0] + (sectionSpan[1] - sectionSpan[0]) * sectionShare : null;
  useEffect(() => {
    sceneRef.current?.setSection(sectionAxis && sectionAt !== null ? { axis: sectionAxis, at: sectionAt } : null);
  }, [sectionAxis, sectionAt]);

  useEffect(() => {
    if (bedPart) sceneRef.current?.setBedView(bedPart.view);
    else if (!fitPreview) sceneRef.current?.setPreview(null);
  }, [bedPart]); // eslint-disable-line react-hooks/exhaustive-deps

  // These previews are only for the Print tab, where they're explained.
  useEffect(() => {
    if (tab !== "print") {
      setFitPreview(null);
      setBedPart(null);
    }
  }, [tab]);

  // Worked out after each build, so that it never holds up the view.
  useEffect(() => {
    if (!lastBuild || !result?.ok) return;
    let current = true;
    engineRef.current
      ?.printReports(result.plan)
      .then((reports) => {
        if (current) setPrintReports(reports);
      })
      .catch(() => {
        // The engine restarted, and the next build asks again.
      });
    return () => {
      current = false;
    };
  }, [lastBuild]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    sceneRef.current?.setExplode(gap);
  }, [gap]);

  // The assembly step being shown, with the parts it doesn't involve faded.
  const [step, setStep] = useState<number | null>(null);
  const stepParts = step !== null && result?.ok ? result.plan.steps[step]?.parts ?? null : null;
  const showStep = (next: number | null) => {
    setStep(next);
    // Separated, so each part can be seen, unless they already are.
    if (next !== null && gap === 0) setGap(STEP_GAP);
  };
  useEffect(() => {
    sceneRef.current?.setFocus(stepParts);
  }, [stepParts?.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab !== "print") setStep(null);
  }, [tab]);

  useEffect(() => {
    // The engine only ever sees plans that passed validation.
    if (result?.ok) engineRef.current?.submit(result.plan);
  }, [result]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  // A choice from the right-click menu, run on the design as it is now.
  const choose = (choice: MenuChoice) => {
    // An array asks how many first, in the menu.
    if (choice.array) return setMenu((open) => open && { ...open, array: choice.array! });
    setMenu(null);
    const result = choice.run(latest.current.config);
    if (!result) return;
    applyConfig(result.config);
    if (result.select !== undefined) setSelected(result.select);
    if (result.pick !== undefined) setPicked(result.pick);
    // What it picks has its fields on the Shape tab, as when it's clicked.
    if (result.pick) {
      setSelected(null);
      setTab("shape");
    }
  };
  const menuOpen = useRef(false);
  menuOpen.current = menu !== null;
  useEffect(() => {
    if (!menu) return;
    // A press anywhere else, or turning the view, closes it.
    const close = (event: Event) => {
      if (!(event.target as HTMLElement).closest?.(".view-menu")) setMenu(null);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("wheel", close, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("wheel", close, true);
    };
  }, [menu]);

  // Each acts on the selected part and any selected with it, as one change.
  const nudge = useCallback((ids: string[], da: number, db: number) => {
    const { config: current, applyConfig: apply } = latest.current;
    const next = ids.reduce((config: RawConfig, id) => {
      const component = config.components?.find((c: any) => c.id === id);
      if (!component) return config;
      const patch = "wall" in component ? { at: component.at + da, z: component.z + db } : "x" in component ? { x: component.x + da, y: component.y + db } : { u: component.u + da, v: component.v + db };
      return updateComponent(config, id, patch);
    }, current);
    apply(next);
  }, []);

  const rotate = useCallback((ids: string[]) => {
    const { config: current, applyConfig: apply } = latest.current;
    const next = ids.reduce((config: RawConfig, id) => {
      const component = config.components?.find((c: any) => c.id === id);
      return component ? updateComponent(config, id, { rotationDeg: ((component.rotationDeg ?? 0) + 90) % 360 }) : config;
    }, current);
    apply(next);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.matches?.("input, textarea, select");
      if (event.key === "Escape" && menuOpen.current) {
        setMenu(null);
        return;
      }
      if (event.key === "Escape" && latest.current.placing) {
        setPlacing(null);
        return;
      }
      if (event.key === "Escape" && !typing) setPicked(null);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        if (typing) return;
        event.preventDefault();
        restore(event.shiftKey ? "redo" : "undo");
        return;
      }
      if (!typing && tab === "screws") {
        const item = fasteners.items.find((f) => f.id === selectedFastener);
        if (event.key === "Escape") setSelectedFastener(null);
        if (item && (event.key === "Delete" || event.key === "Backspace")) {
          event.preventDefault();
          applyConfig(removeFastener(latest.current.config, item));
          setSelectedFastener(null);
        }
        return;
      }
      if (typing) return;
      if (event.key.toLowerCase() === "f" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        lookRef.current();
        return;
      }
      const step = event.shiftKey ? 0.1 : 1;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      const move = moves[event.key];
      const duplicating = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d";
      const { config: current, picked: thing } = latest.current;
      // A part undone away since it was selected is no longer there to act on.
      const part = selected && current.components?.some((c: RawConfig) => c.id === selected) ? selected : null;
      if (!part && thing) {
        // Something selected by clicking it, other than a part.
        let next: RawConfig | null = null;
        if (move) next = nudgeThing(current, thing, move[0], move[1]);
        else if (duplicating) {
          const copy = duplicateThing(current, thing);
          if (copy) {
            next = copy.config;
            setPicked(copy.path);
          }
        } else if (event.key.toLowerCase() === "r" && !event.metaKey && !event.ctrlKey) next = rotateThing(current, thing);
        else if (event.key === "Delete" || event.key === "Backspace") {
          next = removeThing(current, thing);
          if (next) setPicked(null);
        }
        if (move || duplicating || event.key === "Delete" || event.key === "Backspace") event.preventDefault();
        if (next) applyConfig(next);
        return;
      }
      if (!part) return;
      const all = [part, ...latest.current.group];
      if (duplicating) {
        event.preventDefault();
        const copy = duplicateComponent(current, part);
        if (copy) {
          applyConfig(copy.config);
          setSelected(copy.id);
        }
      } else if (move) {
        event.preventDefault();
        nudge(all, move[0], move[1]);
      } else if (event.key.toLowerCase() === "r" && !event.metaKey && !event.ctrlKey) {
        rotate(all);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        applyConfig(all.reduce((config: RawConfig, id) => removeComponent(config, id), current));
        setSelected(null);
      } else if (event.key === "Escape") {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, nudge, rotate, restore, applyConfig, tab, fasteners, selectedFastener]);

  useEffect(() => {
    if (!selected || !model || !result?.ok || dragging.current) return;
    // The same answer holds wherever the part itself is, so its own place is left out of the key.
    const key = JSON.stringify({ ...config, components: (config.components ?? []).map((c: RawConfig) => (c.id === selected ? { ...c, u: 0, v: 0, x: 0, y: 0 } : c)) });
    if (reach.current.key === key && reach.current.id === selected) return;
    reach.current = { key, id: selected, cells: [] };
    const cells = reachCells(config, model, selected);
    const work = () => {
      if (reach.current.key !== key) return;
      const until = performance.now() + 25;
      while (performance.now() < until) {
        const next = cells.next();
        if (next.done) return showReach();
        reach.current.cells.push(next.value);
      }
      showReach();
      window.setTimeout(work, 0);
    };
    // Not cancelled when the part moves, since the answer doesn't change: a new key stops it instead.
    window.setTimeout(work, 200);
  }, [selected, text, result?.ok]); // eslint-disable-line react-hooks/exhaustive-deps

  // Turns the view square onto what's selected, near enough to see it well: F, or a double-click.
  lookRef.current = () => {
    const index = (config.components ?? []).findIndex((c: RawConfig) => c.id === selected);
    const path = index >= 0 ? `components[${index}]` : picked;
    if (!path || !model) return;
    const box = issueSpot({ path }, config, model, fasteners);
    if (!box) return;
    setHover(null);
    sceneRef.current?.lookAt(box, facingFor(config, model, path));
  };

  // Ctrl+C and Ctrl+V copy the selected parts and paste them, here or in another design, while the
  // cursor isn't in a field, where they copy and paste text as usual.
  useEffect(() => {
    const typing = (event: Event) => (event.target as HTMLElement)?.matches?.("input, textarea, select") ?? false;
    const onCopy = (event: ClipboardEvent) => {
      const { config: current, selected: first, group: others } = latest.current;
      if (typing(event) || !first || !event.clipboardData) return;
      const text = copyParts(current, [first, ...others]);
      if (!text) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", text);
      setNotice(others.length ? `Copied ${others.length + 1} parts.` : `Copied ${first}.`);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (typing(event) || !event.clipboardData) return;
      const { config: current, applyConfig: apply } = latest.current;
      const pasted = pasteParts(current, event.clipboardData.getData("text/plain"));
      if (!pasted) return;
      event.preventDefault();
      apply(pasted.config);
      setSelected(pasted.ids[0] ?? null);
      setGroup(pasted.ids.slice(1));
      setPicked(null);
      setTab("layout");
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, []);

  const handleTextChange = (next: string) => {
    setText(next);
    const check = parseConfig(next);
    if (check.ok) commit(next);
  };

  // Replaces the whole design. Undo brings the last one back.
  const loadDesign = (next: string, message: string) => {
    setText(next);
    commit(next);
    setSelected(null);
    setPartEditor(null);
    setSelectedFastener(null);
    setNotice(message);
  };

  const saveFile = () => download(text, `${fileName(String(config.name ?? "enclosure"))}.json`, "application/json");

  const openFile = async (file: File) => {
    const contents = await file.text();
    const check = parseConfig(contents);
    if (check.ok) loadDesign(contents, `Opened ${file.name}. Undo brings your last design back.`);
    else setNotice(`${file.name} isn't a config: ${check.message}`);
  };

  // A link with a design in it loads that design, once, and leaves the address plain again.
  const latestLoad = useRef(loadDesign);
  latestLoad.current = loadDesign;
  useEffect(() => {
    const open = () =>
      void designFromHash(location.hash).then((shared) => {
        if (shared === null) return;
        window.history.replaceState(null, "", location.pathname + location.search);
        const check = parseConfig(shared);
        if (check.ok) latestLoad.current(formatConfig(check.config), "Opened the design from the link. Undo brings yours back.");
        else setNotice(`The link's design isn't a config: ${check.message}`);
      });
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  const copyLink = async () => {
    const url = `${location.origin}${location.pathname}#${await designHash(text)}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice(`Copied a link to this design. It holds the whole design, so it works without a file, once the app is somewhere others can open it.`);
    } catch {
      setNotice("The link couldn't be copied here.");
    }
  };

  const showOnBed = async (index: number) => {
    if (!result?.ok) return;
    if (bedPart?.index === index) {
      setBedPart(null);
      return;
    }
    try {
      setFitPreview(null);
      setBedPart({ index, view: await engineRef.current!.bedView(result.plan, index) });
    } catch (error) {
      setNotice(`That couldn't be shown: ${(error as Error).message}`);
    }
  };

  const designName = String(config.name ?? "enclosure");
  const reprint = reprintStatus(printed[designName], printReports);
  const beds = result?.ok && printReports.length === result.plan.printedParts.length ? bedsFor(result.plan, printReports) : [];
  const changedNames = reprint.filter((part) => part.status === "changed").map((part) => part.name);

  const recordPrinted = () => {
    const next = markPrinted(printed, designName, printReports);
    savePrinted(next);
    setPrinted(next);
  };

  const exportBundle = async (only?: string[]) => {
    if (!result?.ok) return;
    try {
      const bytes = await engineRef.current!.bundle(result.plan, only);
      download(bytes, `${fileName(String(config.name ?? "enclosure"))}-${only ? "reprint" : "print"}.zip`, "application/zip");
      setTutorial((t) => t && { ...t, exported: true });
    } catch (error) {
      setNotice(`Export failed: ${(error as Error).message}`);
    }
  };

  const exportPart = async (index: number, partName: string, format: "stl" | "step") => {
    if (!result?.ok) return;
    try {
      const bytes = await engineRef.current!.exportPart(result.plan, index, format);
      const name = `${fileName(`${String(config.name ?? "enclosure")} ${partName}`)}.${format}`;
      download(bytes, name, format === "stl" ? "model/stl" : "model/step");
    } catch (error) {
      setNotice(`Export failed: ${(error as Error).message}`);
    }
  };

  const showFitTest = async (plan: FitTestPlan | null) => {
    try {
      setBedPart(null);
      setFitPreview(plan ? await engineRef.current!.buildFitTest(plan) : null);
    } catch (error) {
      setNotice(`The fit test couldn't be built: ${(error as Error).message}`);
    }
  };

  const exportFitTest = async (plan: FitTestPlan, index: number, partName: string, format: "stl" | "step") => {
    try {
      const bytes = await engineRef.current!.exportFitTest(plan, index, format);
      const name = `${fileName(`${String(config.name ?? "enclosure")} ${partName}`)}.${format}`;
      download(bytes, name, format === "stl" ? "model/stl" : "model/step");
    } catch (error) {
      setNotice(`Export failed: ${(error as Error).message}`);
    }
  };

  // Waits for a click in the view to say where it goes, where there's a view to click in.
  const addPart = () => {
    const part = partsOf(config)[chosenPart];
    setTab("layout");
    if (part && lastBuild && valid) return setPlacing(placingPart(config, chosenPart, part, selectedComponent?.surface));
    const { config: next, id } = addComponent(config, chosenPart, selectedComponent?.surface);
    applyConfig(next);
    setSelected(id);
  };
  // A part dragged from the library and dropped on the view goes where it was dropped, if it can.
  const dropPart = (type: string, part: Part, x: number, y: number) => {
    const faces = sceneRef.current?.facesAt(x, y) ?? [];
    const dropping = placingPart(config, type, part, selectedComponent?.surface);
    const spot = model ? spotFor(dropping, faces.map((face) => spotAt(model, face.point, face.normal))) : null;
    setPlacing(null);
    setTab("layout");
    if (!spot) return setNotice(`The ${part.name} goes on ${ontoWords(dropping)}. Drop it there.`);
    applyConfig(dropping.at(config, spot));
    if (dropping.selects) setSelected(dropping.selects);
  };
  const placeInMiddle = () => {
    if (!placing) return;
    applyConfig(placing.middle(config));
    if (placing.selects) setSelected(placing.selects);
    setPlacing(null);
  };

  const selectIssue = (issue: Issue) => {
    // Clicked again once it's shown, the view turns to it and comes near.
    const again = shownIssue && shownIssue.message === issue.message && shownIssue.path === issue.path;
    if (again && model) {
      const box = issueSpot(issue, config, model, fasteners);
      if (box) sceneRef.current?.lookAt(box);
      return;
    }
    setShownIssue(issue);
    const id = issue.componentIds[issue.componentIds.length - 1];
    if (issue.path.startsWith("fabrication.fit")) {
      setTab("print");
      return;
    }
    const aboutScrews = issue.code === "FASTENER_GAP" || issue.code === "FASTENER_CHANGE_UNUSED" || /\bfasteners\b/.test(issue.path);
    if (id) {
      setSelected(id);
      setTab("layout");
    } else if (aboutScrews) {
      setTab("screws");
      if (fasteners.items.some((f) => f.id === issue.path)) setSelectedFastener(issue.path);
    } else {
      setTab(/^(name|enclosure|topPanels|seams|wallHoles|vents|labels|fabrication|opening|plate\.(seamX|countersunkHoles|pins|cableTies))\b/.test(issue.path) ? "shape" : "config");
    }
  };

  const savePart = (part: Part) => {
    const id = partEditor?.id;
    if (id) {
      applyConfig(updateCustomPart(config, id, part));
    } else {
      const created = addCustomPart(config, part);
      const placed = addComponent(created.config, created.id, selectedComponent?.surface);
      applyConfig(placed.config);
      setPartToAdd(created.id);
      setSelected(placed.id);
    }
    setPartEditor(null);
  };

  const deletePart = (id: string) => {
    applyConfig(removeCustomPart(config, id));
    setPartEditor(null);
    if (selectedComponent?.type === id) setSelected(null);
  };

  const editablePart = (id: string) => (customParts[id] ? draftFromPart(customParts[id]) : null);

  const changeField = (field: string, value: string) => {
    if (!selected || value === "") return;
    const number = Number(value);
    if (Number.isFinite(number)) applyConfig(updateComponent(config, selected, { [field]: number }));
  };

  const valid = result?.ok === true;
  const neighbour = model && selectedComponent ? nearestNeighbour(model, selectedComponent.id) : null;
  const measurement = measured.length === 2 ? measureBetween(measured[0]!, measured[1]!) : null;
  const tutorialState: TutorialState = { config, issues: [...errors, ...warnings], ok: result?.ok === true, exported: tutorial?.exported ?? false };
  // Never ahead of the design: if an earlier step comes undone, it goes back to it.
  const tutorialStep = tutorial && !tutorial.finished ? Math.min(tutorial.step, firstUnfinished(tutorialState, tutorial.step)) : 0;
  const tutorialTarget = tutorial && !tutorial.finished ? TUTORIAL[tutorialStep]?.target : undefined;
  useEffect(() => {
    // The control the step is about is outlined, wherever it is now.
    const marked = tutorialTarget ? [...document.querySelectorAll(tutorialTarget)] : [];
    for (const element of marked) element.classList.add("tutorial-target");
    return () => {
      for (const element of marked) element.classList.remove("tutorial-target");
    };
  });

  const printedPartName = (index: number) => (result?.ok ? (result.plan.printedParts[index]?.name ?? `part ${index + 1}`) : `part ${index + 1}`);
  const buildSummary = !lastBuild
    ? valid
      ? "Loading engine…"
      : ""
    : lastBuild.rebuilt === "all"
      ? `Rebuilt everything in ${Math.round(lastBuild.shownMs)} ms`
      : lastBuild.rebuilt.length === 0
        ? "No geometry changed"
        : `Re-cut ${lastBuild.rebuilt.map((i) => printedPartName(i)).join(", ")} in ${Math.round(lastBuild.shownMs)} ms`;
  const printedParts = result?.ok ? result.plan.printedParts : [];
  const hardware = result?.ok ? result.plan.hardware : [];
  const assembly = result?.ok ? result.plan.assembly : [];
  const pins = result?.ok ? result.plan.pins : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="title">
          <h1>{String(config.name ?? "Untitled enclosure")}</h1>
        </div>
        <div className="status" role="status" aria-live="polite" data-testid="status">
          <span className={`dot ${!parsed.ok || errors.length ? "bad" : "good"}`} aria-hidden="true" />
          {!parsed.ok
            ? "The config isn't valid JSON"
            : errors.length
              ? `${errors.length} ${errors.length === 1 ? "problem" : "problems"}${lastBuild ? ", showing the last valid model" : ""}`
              : `Valid, ${printedParts.length} printed ${printedParts.length === 1 ? "part" : "parts"}`}
          <span className="status-detail">{busy ? "Building…" : parsed.ok && !errors.length ? buildSummary : ""}</span>
        </div>
        <div className="actions">
          <label className="sr-only" htmlFor="new-design">Start a new design</label>
          <select
            id="new-design"
            className="example-picker"
            value=""
            onChange={(e) => {
              const template = TEMPLATES.find((t) => t.name === e.target.value);
              if (!template) return;
              const profile = loadProfile();
              const made = template.make();
              loadDesign(formatConfig(profile ? applyProfile(made, profile) : made), `Started from ${template.name}${profile ? ", with your printer's sizes" : ""}. Undo brings your last design back.`);
              setTab("shape");
            }}
          >
            <option value="" disabled>New</option>
            {TEMPLATES.map((t) => <option key={t.name} value={t.name}>{t.name}: {t.description}</option>)}
          </select>
          <button onClick={() => openInput.current?.click()}>Open</button>
          <button onClick={saveFile} disabled={!parsed.ok}>Save</button>
          <button onClick={() => void copyLink()} disabled={!parsed.ok}>Copy link</button>
          <input
            ref={openInput}
            className="sr-only"
            type="file"
            accept=".json,application/json"
            tabIndex={-1}
            aria-label="Open a config file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void openFile(file);
            }}
          />
          <label className="sr-only" htmlFor="load-example">Load an example</label>
          <select
            id="load-example"
            className="example-picker"
            value=""
            onChange={(e) => {
              const name = e.target.value;
              const example = EXAMPLES[name];
              if (!example) return;
              loadDesign(example, `Loaded the ${name} example. Undo brings your last design back.`);
            }}
          >
            <option value="" disabled>Examples</option>
            {Object.keys(EXAMPLES).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <button onClick={() => restore("undo")} disabled={!canUndo}>Undo</button>
          <button onClick={() => restore("redo")} disabled={!canRedo}>Redo</button>
          <button onClick={() => loadDesign(exampleText, "Reset to the Desk Synth example. Undo brings your last design back.")}>Reset</button>
          <button
            onClick={() => {
              loadDesign(formatConfig(tutorialStart()), "Started the tutorial with a new design. Undo brings your last design back.");
              setTutorial({ step: 0, finished: false, exported: false });
              setTab("shape");
            }}
          >
            Tutorial
          </button>
        </div>
      </header>

      <aside className="panel">
        <div className="tabs" role="tablist">
          <button role="tab" data-tab="shape" aria-selected={tab === "shape"} onClick={() => setTab("shape")}>Shape</button>
          <button role="tab" data-tab="layout" aria-selected={tab === "layout"} onClick={() => setTab("layout")}>Layout</button>
          <button role="tab" data-tab="screws" aria-selected={tab === "screws"} onClick={() => setTab("screws")}>Screws</button>
          <button role="tab" data-tab="print" aria-selected={tab === "print"} onClick={() => setTab("print")}>Print</button>
          <button role="tab" data-tab="config" aria-selected={tab === "config"} onClick={() => setTab("config")}>Config</button>
        </div>

        {tab === "shape" ? (
          <ShapePanel config={config} onChange={(next) => applyConfig(next)} picked={picked} onField={setFocusedField} onPick={(path) => {
              setPicked(path);
              if (path) setSelected(null);
            }} {...(lastBuild && valid ? { onPlace: setPlacing } : {})} />
        ) : tab === "layout" ? (
          <div className="tab-body">
            <section className="add-part">
              <label htmlFor="part-to-add">Add a part</label>
              <div className="row">
                <select id="part-to-add" value={chosenPart} onChange={(e) => setPartToAdd(e.target.value)}>
                  {Object.entries(parts).map(([id, part]) => (
                    <option key={id} value={id}>{part.name}{part.source === "measured" ? "" : part.source === "datasheet" ? " (from a datasheet)" : " (estimated)"}</option>
                  ))}
                </select>
                <button
                  onClick={addPart}
                  draggable={Boolean(lastBuild && valid)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(PART_DRAG, chosenPart);
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  title="Click, then click where it goes in the view. Or drag it there."
                >
                  Add
                </button>
              </div>
              <div className="row part-actions">
                <button onClick={() => setPartEditor({ id: null })}>New custom part</button>
                {editablePart(chosenPart) ? <button onClick={() => setPartEditor({ id: chosenPart })}>Edit this one</button> : null}
              </div>
            </section>

            {partEditor ? (
              <PartForm
                key={partEditor.id ?? "new"}
                initial={(partEditor.id && editablePart(partEditor.id)) || newPartDraft()}
                existing={partEditor.id ? parts[partEditor.id] : undefined}
                onSave={savePart}
                onCancel={() => setPartEditor(null)}
                onDelete={partEditor.id ? () => deletePart(partEditor.id!) : undefined}
              />
            ) : null}

            {selectedComponent && group.length ? (
              <section className="inspector" aria-label="Selected parts">
                <h2>{group.length + 1} parts selected</h2>
                <p className="muted">
                  Lined up with {selectedComponent.id}. Shift-click a part to add it or take it out. The arrow keys, R and Delete act on all of
                  them.
                </p>
                <div className="row">
                  <button onClick={() => applyConfig(lineUpGroup(config, [selectedComponent.id, ...group], "row"))}>Same row</button>
                  <button onClick={() => applyConfig(lineUpGroup(config, [selectedComponent.id, ...group], "column"))}>Same column</button>
                  <button disabled={group.length < 2} onClick={() => applyConfig(spaceEvenly(config, [selectedComponent.id, ...group]))}>
                    Space evenly
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      applyConfig([selectedComponent.id, ...group].reduce((next: RawConfig, id) => removeComponent(next, id), config));
                      setSelected(null);
                    }}
                  >
                    Delete all
                  </button>
                </div>
              </section>
            ) : null}

            {selectedComponent && selectedPart ? (
              <section className="inspector" aria-label="Selected part">
                <h2>{selectedComponent.id}</h2>
                <p className="muted">{selectedPart.name}</p>
                {invalid.has(selectedComponent.id) ? (
                  <div className="row">
                    <button
                      onClick={() => {
                        const next = nearestFit(config, selectedComponent.id);
                        if (next) applyConfig(next);
                        else setNotice(`There's nowhere within 40 mm of where ${selectedComponent.id} is that it fits. The problem list says what's in the way.`);
                      }}
                    >
                      Move it to the nearest spot that fits
                    </button>
                  </div>
                ) : null}
                <div className="fields">
                  {"wall" in selectedComponent ? (
                    <>
                      <label>
                        Wall
                        <select value={selectedComponent.wall} onChange={(e) => applyConfig(updateComponent(config, selectedComponent.id, { wall: e.target.value }))}>
                          {["rear", "left", "right", "front"].map((wall) => <option key={wall} value={wall}>{wall}</option>)}
                        </select>
                      </label>
                      <NumberField label="Along the wall" value={selectedComponent.at} onCommit={(v) => changeField("at", v)} />
                      <NumberField label="Height" value={selectedComponent.z} onCommit={(v) => changeField("z", v)} />
                    </>
                  ) : "x" in selectedComponent ? (
                    <>
                      <NumberField label="Across (x)" value={selectedComponent.x} onCommit={(v) => changeField("x", v)} />
                      <NumberField label="Back (y)" value={selectedComponent.y} onCommit={(v) => changeField("y", v)} />
                    </>
                  ) : (
                    <>
                      <label>
                        Surface
                        <select
                          value={selectedComponent.surface ?? surfaceIds[0]}
                          onChange={(e) => applyConfig(updateComponent(config, selectedComponent.id, { surface: e.target.value }))}
                        >
                          {surfaceIds.map((id) => <option key={id} value={id}>{id}</option>)}
                        </select>
                      </label>
                      <NumberField label="Across (u)" value={selectedComponent.u} onCommit={(v) => changeField("u", v)} />
                      <NumberField label="Back (v)" value={selectedComponent.v} onCommit={(v) => changeField("v", v)} />
                    </>
                  )}
                </div>
                <div className="fields">
                  <TextField
                    label="Label"
                    placeholder="None"
                    value={labelOfComponent(config, selectedComponent.id)?.text ?? ""}
                    onCommit={(text) => applyConfig(setComponentLabel(config, selectedComponent.id, { text }))}
                  />
                  {labelOfComponent(config, selectedComponent.id) ? (
                    <label>
                      Beside it
                      <select
                        value={labelOfComponent(config, selectedComponent.id)!.side ?? "below"}
                        onChange={(e) => applyConfig(setComponentLabel(config, selectedComponent.id, { side: e.target.value as LabelSide }))}
                      >
                        {["below", "above", "left", "right"].map((side) => <option key={side} value={side}>{side}</option>)}
                      </select>
                    </label>
                  ) : null}
                </div>
                {selectedPart.mount === "panel" && selectedPart.shafts?.length ? (
                  <div className="fields">
                    <label className="check">
                      <input type="checkbox" checked={Boolean(selectedComponent.knob)} onChange={(e) => applyConfig(setKnob(config, selectedComponent.id, e.target.checked ? {} : null))} />
                      Print {selectedPart.shafts.length > 1 ? "knobs" : "a knob"} for it
                    </label>
                    {selectedComponent.knob ? (
                      <>
                        <NumberField label="Knob width" value={selectedComponent.knob.diameter ?? 14} onCommit={(diameter) => applyConfig(setKnob(config, selectedComponent.id, { diameter }))} />
                        <NumberField label="Knob height" value={selectedComponent.knob.height ?? 16} onCommit={(height) => applyConfig(setKnob(config, selectedComponent.id, { height }))} />
                      </>
                    ) : null}
                  </div>
                ) : null}
                {selectedPart.mount === "panel" && selectedPart.stems?.length ? (
                  <div className="fields">
                    <label className="check">
                      <input type="checkbox" checked={Boolean(selectedComponent.cap)} onChange={(e) => applyConfig(setCap(config, selectedComponent.id, e.target.checked ? {} : null))} />
                      Print {selectedPart.stems.length > 1 ? "key caps" : "a key cap"} for it
                    </label>
                    {selectedComponent.cap ? (
                      <>
                        <NumberField label="Cap width" value={selectedComponent.cap.width ?? 15} onCommit={(width) => applyConfig(setCap(config, selectedComponent.id, { width }))} />
                        <NumberField label="Cap depth" value={selectedComponent.cap.depth ?? 15} onCommit={(depth) => applyConfig(setCap(config, selectedComponent.id, { depth }))} />
                        <NumberField label="Top thickness" value={selectedComponent.cap.thickness ?? 2.4} step={0.2} onCommit={(thickness) => applyConfig(setCap(config, selectedComponent.id, { thickness }))} />
                      </>
                    ) : null}
                  </div>
                ) : null}
                {neighbour ? <p className="muted note">{neighbour.gap.toFixed(1)} mm to {neighbour.id}</p> : null}
                {selectedPart.notes ? <p className="muted note">{selectedPart.notes}</p> : null}
                <div className="row">
                  <button onClick={() => rotate([selectedComponent.id])}>Rotate 90°</button>
                  <button
                    className="danger"
                    onClick={() => {
                      applyConfig(removeComponent(config, selectedComponent.id));
                      setSelected(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
                {editablePart(selectedComponent.type) ? <button onClick={() => setPartEditor({ id: selectedComponent.type })}>Edit this part's sizes</button> : null}
                <LayoutTools key={selectedComponent.id} config={config} component={selectedComponent} onChange={(next) => applyConfig(next)} onSelect={setSelected} />
                <p className="hint">Drag it in the view, or use the arrow keys. Shift moves in 0.1 mm steps.</p>
              </section>
            ) : (
              <p className="hint empty">Select a part to move it. Turn on “Show inside” to reach the boards on the floor.</p>
            )}

            <section>
              <h2>Parts <span className="count">{components.length}</span></h2>
              <ul className="parts" aria-label="Parts">
                {components.map((c) => (
                  <li key={c.id}>
                    <button
                      className={c.id === selected || group.includes(c.id) ? "selected" : ""}
                      aria-pressed={c.id === selected || group.includes(c.id)}
                      onClick={(event) => {
                        if (event.shiftKey) return toggleRef.current(c.id);
                        setSelected(c.id);
                        setGroup([]);
                      }}
                    >
                      <span className={`dot ${invalid.has(c.id) ? "bad" : "quiet"}`} aria-hidden="true" />
                      <span className="part-id">{c.id}</span>
                      <span className="part-where">{c.surface ?? (c.x !== undefined ? "floor" : "")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <ReferencePanel
              reference={reference}
              loading={referenceLoading}
              problem={referenceProblem}
              onOpen={(file) => void openReference(file)}
              onPlace={(place) => setReference((current) => (current ? { ...current, place } : current))}
              onRemove={() => setReference(null)}
            />
          </div>
        ) : tab === "screws" ? (
          <ScrewsPanel
            config={config}
            fasteners={fasteners}
            selected={selectedFastener}
            dragProblem={dragProblem}
            onSelect={setSelectedFastener}
            onChange={(next) => applyConfig(next)}
            onNotice={setNotice}
          />
        ) : tab === "print" ? (
          <div className="tab-body">
            <section aria-label="Download">
              <h2>Parts to print <span className="count">{printedParts.length}</span></h2>
              {!valid ? <p className="muted note">Fix the problems to download.</p> : null}
              {valid ? <p className="hint">Files come out placed as they should print, on the {result.plan.config.fabrication.buildVolume.x} mm bed, so don't turn them in the slicer.</p> : null}
              {valid && printReports.length ? <PrintCost reports={printReports} /> : null}
              <div className="row">
                <button data-tutorial="download" onClick={() => void exportBundle()} disabled={!valid}>Download everything</button>
                {changedNames.length ? <button onClick={() => void exportBundle(changedNames)} disabled={!valid}>Download what changed</button> : null}
                <button onClick={recordPrinted} disabled={!valid || printReports.length === 0}>Mark as printed</button>
              </div>
              {printed[designName] ? <p className="hint">{changedNames.length ? `${changedNames.length} of ${reprint.length} need reprinting since you marked them printed.` : "Nothing has changed since you marked these printed."}</p> : null}
              {printedParts.map((part) => {
                const report = printReports.find((r) => r.index === part.index && r.name === part.name);
                return (
                  <div key={part.index}>
                    <div className="row print-part">
                      <span className="swatch" style={{ background: part.color }} aria-hidden="true" />
                      <span className="print-name">
                        {part.name}
                        <span className="muted print-size">{(report?.best.size ?? part.size).map((s) => s.toFixed(0)).join(" × ")} mm</span>
                      </span>
                      <button onClick={() => void showOnBed(part.index)} disabled={!valid || !report} aria-pressed={bedPart?.index === part.index}>Bed</button>
                      <button onClick={() => exportPart(part.index, part.name, "stl")} disabled={!valid}>STL</button>
                      <button onClick={() => exportPart(part.index, part.name, "step")} disabled={!valid}>STEP</button>
                    </div>
                    {report ? (
                      <div className="print-report">
                        <span>{report.best.label}, {describeEstimate(report.estimate)}</span>
                        {printed[designName] ? <span className={reprint.find((r) => r.name === part.name)?.status === "same" ? "clear" : "needs"}>{reprint.find((r) => r.name === part.name)?.status === "same" ? "Same as printed" : "Needs reprinting"}</span> : null}
                        <span className={report.needsSupport ? "needs" : "clear"}>{report.needsSupport ? "Turn on supports" : "No supports needed"}</span>
                        {[...report.problems, ...report.notes, ...report.resolved].map((note) => <span key={note}>{note}</span>)}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {bedPart ? <p className="hint">Red is a roof that needs support or has to bridge, amber droops a little, and each red dot has nothing under it.</p> : null}
            </section>
            {valid && beds.length && beds.length < printReports.length ? (
              <section>
                <h2>Sharing the bed <span className="count">{beds.length}</span></h2>
                <p className="hint">Parts of one colour that fit on the bed together. Turning one a quarter, flat on the bed, is fine.</p>
                <ol className="hardware">
                  {beds.map((bed, i) => (
                    <li key={i}>
                      <span className="swatch" style={{ background: bed.color }} aria-hidden="true" /> {describeBed(bed)}, {describeEstimate({ hours: bed.hours, grams: bed.grams })}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            {hardware.length ? (
              <section>
                <h2>Hardware</h2>
                <ul className="hardware">
                  {hardware.map((item) => <li key={item.name}>{item.count} × {item.name}</li>)}
                </ul>
              </section>
            ) : null}
            {pins ? (
              <section>
                <h2>Pins <span className="count">{pins.used} of {pins.gpio}</span></h2>
                <p className="hint">On "{pins.controller}", if wired this way. Switches go through shift registers, and the I2C parts share the bus.</p>
                <ul className="hardware">
                  {pins.uses.map((use) => <li key={use.what}>{use.pins} × {use.what}</li>)}
                </ul>
                {pins.addresses.length ? (
                  <ul className="hardware">
                    {pins.addresses.map((a) => <li key={a.id}>{a.id} at {hex(a.address)}</li>)}
                  </ul>
                ) : null}
              </section>
            ) : null}
            {result?.ok && result.plan.wiring.routes.length ? (
              <section>
                <h2>Wires <span className="count">{result.plan.wiring.routes.length}</span></h2>
                <p className="hint">Along their routes across the floor, shown with Wires in the view, down from each part and up to its board. {WIRE_SLACK_NOTE}</p>
                <ul className="hardware">
                  {result.plan.wiring.routes.map((route) => <li key={route.from}>{route.from} to {route.to}, about {wireLength(route.length)} mm{route.seams.length ? ", across the seam" : ""}</li>)}
                </ul>
              </section>
            ) : null}
            {assembly.length ? (
              <section>
                <h2>Putting it together</h2>
                <ol className="hardware assembly">
                  {assembly.map((text, index) => (
                    <li key={text}>
                      <button className={`step${step === index ? " active" : ""}`} aria-pressed={step === index} onClick={() => showStep(step === index ? null : index)}>
                        {text}
                      </button>
                    </li>
                  ))}
                </ol>
                {step !== null ? (
                  <div className="row">
                    <button onClick={() => showStep(step - 1)} disabled={step === 0}>Back</button>
                    <button onClick={() => showStep(step + 1 < assembly.length ? step + 1 : null)}>{step + 1 < assembly.length ? "Next step" : "Done"}</button>
                  </div>
                ) : null}
                <p className="hint">Choose a step to see its parts on their own, separated. Every screw is checked for a clear path for a driver, in this order.</p>
              </section>
            ) : null}
            {result?.ok ? (
              <FitTestPanel
                config={config}
                plan={result.plan}
                showing={fitPreview !== null}
                onShow={(plan) => void showFitTest(plan)}
                onExport={(plan, index, name, format) => void exportFitTest(plan, index, name, format)}
                onChange={(next) => applyConfig(next)}
              />
            ) : null}
          </div>
        ) : (
          <div className="tab-body config-body">
            <VersionsPanel text={text} onRestore={(next, name) => loadDesign(next, `Went back to "${name}". Undo brings what you had back.`)} />
            <label htmlFor="config-text" className="sr-only">Config JSON</label>
            <textarea
              id="config-text"
              spellCheck={false}
              value={text}
              onChange={(e) => handleTextChange(e.target.value)}
            />
            <p className="hint">Changes apply as you type. Dragging a part updates this text.</p>
          </div>
        )}

        <section className="issues" aria-label="Problems and warnings">
          {!parsed.ok ? <div className="issue error"><strong>Invalid JSON</strong><span>{parsed.message}</span></div> : null}
          {engineProblem ? <div className="issue error"><strong>The engine couldn't build this</strong><span>{engineProblem}</span></div> : null}
          {notice ? <div className="issue notice"><span>{notice}</span></div> : null}
          {errors.map((issue, i) => <IssueRow key={`e${i}`} issue={issue} onSelect={selectIssue} />)}
          {warnings.map((issue, i) => <IssueRow key={`w${i}`} issue={issue} onSelect={selectIssue} />)}
          {parsed.ok && !errors.length && !warnings.length && !engineProblem ? <p className="hint">No problems found.</p> : null}
        </section>
      </aside>

      <main className="stage">
        <div
          className="viewport"
          ref={viewportRef}
          data-testid="viewport"
          aria-label="3D view of the enclosure"
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(PART_DRAG)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            const type = event.dataTransfer.getData(PART_DRAG);
            const part = partsOf(config)[type];
            if (!type || !part || !model) return;
            event.preventDefault();
            dropPart(type, part, event.clientX, event.clientY);
          }}
        />
        {tab === "layout" && selectedComponent && !group.length && model && !placing
          ? dimensionsFor(model, selectedComponent.id).map((dimension) => {
              const at = sceneRef.current?.project(dimension.at);
              if (!at || dimension.value < 0) return null;
              const words = { left: "the left end", right: "the right end", front: "the front edge", back: "the back edge" }[dimension.side];
              const place = (text: string) => {
                setEditingSide(null);
                const value = Number(text);
                // Left as it was, it changes nothing, rather than nudging the part by a rounding.
                if (text.trim() === "" || !Number.isFinite(value) || value === dimension.value) return;
                const centre = placeForDimension(model, selectedComponent.id, dimension.side, value);
                if (!centre) return;
                const [a, b] = centre;
                const patch = "wall" in selectedComponent ? { at: a, z: b } : "x" in selectedComponent ? { x: a, y: b } : { u: a, v: b };
                applyConfig(updateComponent(config, selectedComponent.id, patch));
              };
              return editingSide === dimension.side ? (
                <input
                  key={dimension.side}
                  className="view-dimension"
                  style={{ left: at.x, top: at.y }}
                  type="number"
                  step={0.5}
                  autoFocus
                  onFocus={(event) => event.target.select()}
                  defaultValue={dimension.value}
                  aria-label={`Distance to ${words}`}
                  onBlur={(event) => place(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") place((event.target as HTMLInputElement).value);
                    if (event.key === "Escape") setEditingSide(null);
                  }}
                />
              ) : (
                <button
                  key={dimension.side}
                  className="view-dimension"
                  style={{ left: at.x, top: at.y }}
                  title={`${dimension.value} mm to ${words}. Click to type what it should be.`}
                  onClick={() => setEditingSide(dimension.side)}
                >
                  {dimension.value}
                </button>
              );
            })
          : null}
        {tutorial ? (
          <TutorialPanel
            state={tutorialState}
            step={tutorialStep}
            finished={tutorial.finished}
            printedParts={result?.ok ? result.plan.printedParts.length : 0}
            onBack={() => setTutorial({ ...tutorial, step: Math.max(0, tutorialStep - 1) })}
            onNext={() => setTutorial(tutorialStep + 1 >= TUTORIAL.length ? { ...tutorial, finished: true } : { ...tutorial, step: tutorialStep + 1 })}
            onLeave={() => setTutorial(null)}
          />
        ) : null}
        {selectBox ? (
          <div
            className="select-box"
            style={{ left: Math.min(selectBox.x0, selectBox.x1), top: Math.min(selectBox.y0, selectBox.y1), width: Math.abs(selectBox.x1 - selectBox.x0), height: Math.abs(selectBox.y1 - selectBox.y0) }}
          />
        ) : null}
        {hover && !menu ? (
          <div className="view-hover" role="tooltip" style={{ left: Math.min(hover.x + 14, window.innerWidth - 300), top: hover.y + 16 }}>
            {hover.text}
          </div>
        ) : null}
        {menu ? (
          <div className="view-menu" role="menu" aria-label={menu.title} style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 40 - (menu.array ? 160 : 32 * menu.choices.length)) }}>
            <p>{menu.array ? `${menu.title}: make an array` : menu.title}</p>
            {menu.array ? (
              <ArrayMenuForm
                config={config}
                target={menu.array}
                onMake={(next) => {
                  setMenu(null);
                  applyConfig(next);
                }}
              />
            ) : null}
            {menu.array ? null : menu.choices.map((choice) => (
              <button key={choice.label} role="menuitem" className={choice.danger ? "danger" : undefined} onClick={() => choose(choice)}>
                {choice.label}
              </button>
            ))}
          </div>
        ) : null}
        {placing ? (
          <p className="measure-readout placing" role="status">
            {placingMissed ? `That isn't ${ontoWords(placing)}. ` : ""}Click {ontoWords(placing)} to put {placing.what} there.
            <button onClick={placeInMiddle}>Put it in the middle</button>
            <button onClick={() => setPlacing(null)}>Cancel</button>
          </p>
        ) : null}
        {measuring ? (
          <p className="measure-readout" role="status">
            {measurement
              ? `${measurement.distance.toFixed(2)} mm (x ${measurement.dx.toFixed(2)}, y ${measurement.dy.toFixed(2)}, z ${measurement.dz.toFixed(2)})${gap > 0 ? ", with the parts separated" : ""}`
              : measured.length === 1
                ? "Click a second point."
                : "Click two points on the model."}
          </p>
        ) : null}
        {!lastBuild && !valid ? (
          <p className="stage-message">Nothing to show yet. Fix the problems in this config, or press New to start over.</p>
        ) : null}
        <div className="view-tools">
          <div className="segmented" role="group" aria-label="View">
            {(["iso", "top", "front", "under"] as ViewPreset[]).map((preset) => (
              <button key={preset} onClick={() => sceneRef.current?.setView(preset)}>
                {preset === "iso" ? "3D" : preset === "top" ? "Top" : preset === "front" ? "Front" : "Under"}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={seeThrough} disabled={tab === "screws"} onChange={(e) => setInternals(e.target.checked)} /> Show inside
          </label>
          <label className="check" title="Where each part's wires leave it, and their ways across the floor to the board they go to">
            <input type="checkbox" checked={showWires} onChange={(e) => setShowWires(e.target.checked)} /> Wires
          </label>
          <button aria-pressed={measuring} className={measuring ? "selected" : ""} onClick={() => setMeasuring(!measuring)}>Measure</button>
          <label className="check">
            Section
            <select className="section-axis" value={sectionAxis ?? ""} onChange={(e) => setSectionAxis((e.target.value || null) as SectionAxis | null)}>
              <option value="">Off</option>
              <option value="x">Across the width</option>
              <option value="y">Front to back</option>
              <option value="z">By height</option>
            </select>
          </label>
          {sectionAxis ? (
            <label className="slider">
              <span className="section-at">{sectionAxis} {sectionAt?.toFixed(1)} mm</span>
              <input type="range" min={0} max={1} step={0.002} value={sectionShare} onChange={(e) => setSectionShare(Number(e.target.value))} />
            </label>
          ) : null}
          <label className="slider">
            Separate parts
            <input type="range" min={0} max={80} value={gap} onChange={(e) => setGap(Number(e.target.value))} />
          </label>
        </div>
      </main>
    </div>
  );
}

function IssueRow({ issue, onSelect }: { issue: Issue; onSelect(issue: Issue): void }) {
  return (
    <button className={`issue ${issue.severity}`} onClick={() => onSelect(issue)} title="Click to show it and select what it's about. Click again to look at it.">
      <strong>{issue.severity === "error" ? "Problem" : "Warning"}</strong>
      <span>{issue.message}</span>
      <code>{issue.path}</code>
    </button>
  );
}
