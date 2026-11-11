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
import { Scene3D, type SceneColors, type ViewPreset } from "./Scene3D.js";
import { buildSceneModel, issueSpot, measureBetween, nearestNeighbour, sectionRange, snap, type SectionAxis } from "./sceneModel.js";
import { ScrewsPanel } from "./ScrewsPanel.js";
import { VersionsPanel } from "./VersionsPanel.js";
import { ShapePanel } from "./ShapePanel.js";
import { ontoWords, placingPart, spotFor, type Placing } from "./placeEdit.js";
import { spotAt } from "./pickSpot.js";
import { thingAt } from "./pickThing.js";
import { duplicateComponent, duplicateThing, nudgeThing, removeThing, rotateThing } from "./thingKeys.js";
import { bedsFor, describeBed } from "../bedLayout.js";
import { ReferencePanel, type LoadedReference } from "./ReferencePanel.js";
import { referenceMiddle, referenceTransform, startingPlace } from "../reference.js";
import type { ReferenceMesh } from "./engineClient.js";
import { addCustomPart, draftFromPart, newPartDraft, removeCustomPart, updateCustomPart } from "./shapeEdit.js";
import { TEMPLATES } from "./templates.js";

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
  const latest = useRef({ config, applyConfig, model, text, commit, fasteners, placing, seeThrough, tab: tab as string, picked });
  latest.current = { config, applyConfig, model, text, commit, fasteners, placing, seeThrough, tab, picked };

  useEffect(() => {
    const scene = new Scene3D(
      viewportRef.current!,
      {
        onSelect: setSelected,
        onDragStart: () => {},
        onDrag: (id, a, b) => {
          const { config: current, applyConfig: apply, model: scene3d } = latest.current;
          const mount = scene3d?.components.find((c) => c.id === id)?.mount;
          const step = 0.5;
          const patch = mount === "wall" ? { at: snap(a, step), z: snap(b, step) } : mount === "floor" ? { x: snap(a, step), y: snap(b, step) } : { u: snap(a, step), v: snap(b, step) };
          apply(updateComponent(current, id, patch), false);
        },
        onDragEnd: () => latest.current.commit(latest.current.text),
        onMeasure: setMeasured,
        onClick: (faces) => {
          const { config: current, model: scene3d, seeThrough: through, tab: on } = latest.current;
          if (!scene3d || (on !== "shape" && on !== "layout")) return;
          const path = thingAt(current, faces.map((face) => spotAt(scene3d, face.point, face.normal)), through);
          // From the Layout tab, where a click on the model is how a part is let go of, only
          // something in particular is worth leaving for, not the bare surface or wall.
          const bare = path !== null && /^enclosure\./.test(path);
          const wanted = on === "layout" && bare ? null : path;
          setPicked(wanted);
          if (wanted) setTab("shape");
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
    sceneRef.current?.setModel(model, selected, invalid);
  }, [model, selected, invalid, seeThrough]);

  useEffect(() => {
    sceneRef.current?.setInternals(seeThrough);
    sceneRef.current?.setModel(model, selected, invalid);
  }, [seeThrough]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // What's picked is lit up where it is now, so it follows as its numbers change.
  useEffect(() => {
    if (picked === null && shownIssue) return;
    sceneRef.current?.setHighlight(picked && model ? issueSpot({ path: picked }, config, model, fasteners) : null, "selection");
  }, [picked, text]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const nudge = useCallback((id: string, da: number, db: number) => {
    const { config: current, applyConfig: apply } = latest.current;
    const component = current.components?.find((c: any) => c.id === id);
    if (!component) return;
    const patch = "wall" in component ? { at: component.at + da, z: component.z + db } : "x" in component ? { x: component.x + da, y: component.y + db } : { u: component.u + da, v: component.v + db };
    apply(updateComponent(current, id, patch));
  }, []);

  const rotate = useCallback((id: string) => {
    const { config: current, applyConfig: apply } = latest.current;
    const component = current.components?.find((c: any) => c.id === id);
    if (component) apply(updateComponent(current, id, { rotationDeg: ((component.rotationDeg ?? 0) + 90) % 360 }));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.matches?.("input, textarea, select");
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
      if (duplicating) {
        event.preventDefault();
        const copy = duplicateComponent(current, part);
        if (copy) {
          applyConfig(copy.config);
          setSelected(copy.id);
        }
      } else if (move) {
        event.preventDefault();
        nudge(part, move[0], move[1]);
      } else if (event.key.toLowerCase() === "r" && !event.metaKey && !event.ctrlKey) {
        rotate(part);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        applyConfig(removeComponent(current, part));
        setSelected(null);
      } else if (event.key === "Escape") {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, nudge, rotate, restore, applyConfig, tab, fasteners, selectedFastener]);

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
  const placeInMiddle = () => {
    if (!placing) return;
    applyConfig(placing.middle(config));
    if (placing.selects) setSelected(placing.selects);
    setPlacing(null);
  };

  const selectIssue = (issue: Issue) => {
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
        </div>
      </header>

      <aside className="panel">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "shape"} onClick={() => setTab("shape")}>Shape</button>
          <button role="tab" aria-selected={tab === "layout"} onClick={() => setTab("layout")}>Layout</button>
          <button role="tab" aria-selected={tab === "screws"} onClick={() => setTab("screws")}>Screws</button>
          <button role="tab" aria-selected={tab === "print"} onClick={() => setTab("print")}>Print</button>
          <button role="tab" aria-selected={tab === "config"} onClick={() => setTab("config")}>Config</button>
        </div>

        {tab === "shape" ? (
          <ShapePanel config={config} onChange={(next) => applyConfig(next)} picked={picked} onPick={(path) => {
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
                <button onClick={addPart}>Add</button>
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

            {selectedComponent && selectedPart ? (
              <section className="inspector" aria-label="Selected part">
                <h2>{selectedComponent.id}</h2>
                <p className="muted">{selectedPart.name}</p>
                <div className="fields">
                  {"wall" in selectedComponent ? (
                    <>
                      <label>
                        Wall
                        <select value={selectedComponent.wall} onChange={(e) => applyConfig(updateComponent(config, selectedComponent.id, { wall: e.target.value }))}>
                          {["rear", "left", "right", "front"].map((wall) => <option key={wall} value={wall}>{wall}</option>)}
                        </select>
                      </label>
                      <NumberField label="Along" value={selectedComponent.at} onCommit={(v) => changeField("at", v)} />
                      <NumberField label="Height" value={selectedComponent.z} onCommit={(v) => changeField("z", v)} />
                    </>
                  ) : "x" in selectedComponent ? (
                    <>
                      <NumberField label="x" value={selectedComponent.x} onCommit={(v) => changeField("x", v)} />
                      <NumberField label="y" value={selectedComponent.y} onCommit={(v) => changeField("y", v)} />
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
                      <NumberField label="u" value={selectedComponent.u} onCommit={(v) => changeField("u", v)} />
                      <NumberField label="v" value={selectedComponent.v} onCommit={(v) => changeField("v", v)} />
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
                  <button onClick={() => rotate(selectedComponent.id)}>Rotate 90°</button>
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
                      className={c.id === selected ? "selected" : ""}
                      aria-pressed={c.id === selected}
                      onClick={() => setSelected(c.id)}
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
                <button onClick={() => void exportBundle()} disabled={!valid}>Download everything</button>
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
        <div className="viewport" ref={viewportRef} data-testid="viewport" aria-label="3D view of the enclosure" />
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
    <button className={`issue ${issue.severity}`} onClick={() => onSelect(issue)}>
      <strong>{issue.severity === "error" ? "Problem" : "Warning"}</strong>
      <span>{issue.message}</span>
      <code>{issue.path}</code>
    </button>
  );
}
