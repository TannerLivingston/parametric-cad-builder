// The Shape tab: the enclosure itself, as fields rather than JSON. It only writes the config,
// so anything it can't do is still open in the Config tab, and every problem still comes from
// the validator.
import { type ReactNode, useEffect, useRef, type FocusEvent } from "react";
import type { RawConfig } from "./configEdit.js";
import { ColorField, NumberField, TextField } from "./fields.js";
import {
  setShiftRegisters,
  setWiringChecks,
  tiesAlongWires,
  feetAtCorners,
  addReservedRoom,
  addSurface,
  DEFAULT_TOP_COLOR,
  parseSplits,
  removePlateHole,
  removeCableTie,
  removePlatePin,
  removeFoot,
  removeWeight,
  removeSupport,
  removeVent,
  removeReservedRoom,
  removeSurface,
  removeWallHole,
  renameSurface,
  setBed,
  setBow,
  setOpening,
  setPlateJoint,
  setPlateSplit,
  setRail,
  setRailScrew,
  setRound,
  setSeam,
  setSurfaceBulge,
  setSurfaceThickness,
  removeSeam,
  updateSeam,
  setTopPanel,
  shapeValues,
  updateEnclosure,
  updateFabrication,
  updateOpening,
  updatePlateHole,
  updateCableTie,
  updateFoot,
  updateWeight,
  updateSupport,
  updatePlatePin,
  updateVent,
  updateRail,
  updateReservedRoom,
  updateSurface,
  updateWallHole,
} from "./shapeEdit.js";
import { removeLabel, updateLabel } from "./labelEdit.js";
import { PLACING, type Placing } from "./placeEdit.js";
import { WALLS_PATH } from "./pickThing.js";

const WALLS = ["left", "right", "front", "rear"] as const;
const LABEL_SIDES = ["below", "above", "left", "right"] as const;

// `onPlace` hands something to be put where the next click in the view lands. Without it, there's
// no view to click in, and it goes in the middle.
// `picked` is the path in the config of what was clicked in the view, whose fields are marked and
// scrolled to. `onPick` says which fields have the focus, so that the view can light up what they're for.
export function ShapePanel({ config, onChange, onPlace, picked, alsoPicked = [], onPick, onField, banner }: { config: RawConfig; onChange(next: RawConfig): void; onPlace?(placing: Placing): void; picked?: string | null; alsoPicked?: string[]; onPick?(path: string | null): void; onField?(path: string | null): void; banner?: ReactNode }) {
  const place = (placing: Placing) => (onPlace ? onPlace(placing) : onChange(placing.middle(config)));
  const root = useRef<HTMLDivElement>(null);
  // Fields for one thing in the design, marked when it's the one picked.
  const card = (path: string, name = "surface-card") => ({ className: picked === path || alsoPicked.includes(path) ? `${name} picked` : name, "data-path": path });
  useEffect(() => {
    if (!picked) return;
    const fields = root.current?.querySelector(`[data-path="${picked}"]`);
    // Not when the focus is already in them, which is how they came to be picked.
    if (fields && !fields.contains(document.activeElement)) fields.scrollIntoView?.({ block: "center" });
  }, [picked]);
  const focused = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const path = target.closest?.("[data-path]")?.getAttribute("data-path");
    if (path && path !== picked) onPick?.(path);
    // And the one number, where its field says which, to light up just its part of the shape.
    onField?.(target.closest?.("[data-field]")?.getAttribute("data-field") ?? null);
  };
  const { enclosure: e, fabrication, topPanels, seams, wallHoles, opening, plate } = shapeValues(config);
  const labels: RawConfig[] = config.labels ?? [];
  const vents: RawConfig[] = config.vents ?? [];
  const cableTies: RawConfig[] = config.plate?.cableTies ?? [];
  // Ignores a field left empty, rather than turning it into 0.
  const number = (apply: (value: number) => RawConfig) => (text: string) => {
    const value = Number(text);
    if (text !== "" && Number.isFinite(value)) onChange(apply(value));
  };
  // For a setting that can be left out, where an empty field means just that.
  const optional = (apply: (value: number | undefined) => RawConfig) => (text: string) => {
    const value = Number(text);
    if (text.trim() === "") onChange(apply(undefined));
    else if (Number.isFinite(value)) onChange(apply(value));
  };

  return (
    <div className="tab-body shape-form" ref={root} onFocus={focused} onBlur={() => onField?.(null)}>
      {banner}
      <section className="fields single">
        <TextField label="Name" value={String(config.name ?? "")} onCommit={(name) => onChange({ ...config, name })} />
      </section>

      <section>
        <h2>Size</h2>
        <div className="fields">
          <NumberField label="Width" field="enclosure.width" value={e.width} onCommit={number((width) => updateEnclosure(config, { width }))} />
          <NumberField label="Front height" field="enclosure.frontHeight" value={e.frontHeight} onCommit={number((frontHeight) => updateEnclosure(config, { frontHeight }))} />
        </div>
      </section>

      <section>
        <h2>Top surfaces, front to rear</h2>
        <p className="hint">Each one starts where the last one ends, and runs back to a depth at a height. Parts sit on these. The last depth is the depth of the enclosure.</p>
        {e.surfaces.map((surface, index) => {
          const panel = topPanels.find((p) => p.surface === surface.id);
          const next = e.surfaces[index + 1];
          const nextIsPanel = next !== undefined && topPanels.some((p) => p.surface === next.id);
          return (
            <div {...card(`enclosure.surfaces[${index}]`)} key={index}>
              <div className="fields">
                <TextField label="Name" value={surface.id} onCommit={(name) => onChange(renameSurface(config, surface.id, name))} />
                <NumberField label="Depth" field={`enclosure.surfaces[${index}].y`} value={surface.y} onCommit={number((y) => updateSurface(config, surface.id, { y }))} />
                <NumberField label="Height" field={`enclosure.surfaces[${index}].z`} value={surface.z} onCommit={number((z) => updateSurface(config, surface.id, { z }))} />
                <TextField label="Thickness" placeholder={String(e.panelThickness)} value={surface.thickness === undefined ? "" : String(surface.thickness)} onCommit={optional((thickness) => setSurfaceThickness(config, surface.id, thickness))} />
                <TextField label="Curve" placeholder="flat" value={surface.bulge === undefined ? "" : String(surface.bulge)} onCommit={optional((bulge) => setSurfaceBulge(config, surface.id, bulge))} />
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={panel !== undefined}
                  onChange={(event) => onChange(setTopPanel(config, surface.id, event.target.checked ? {} : null))}
                />
                Print as its own piece
              </label>
              {panel ? (
                <div className="fields">
                  <ColorField label="Colour" value={panel.color ?? DEFAULT_TOP_COLOR} onCommit={(color) => onChange(setTopPanel(config, surface.id, { color }))} />
                  <TextField
                    label="Split at x"
                    placeholder="None"
                    value={panel.splits.join(", ")}
                    onCommit={(text) => {
                      const splits = parseSplits(text);
                      if (splits) onChange(setTopPanel(config, surface.id, { splits }));
                    }}
                  />
                  {nextIsPanel ? (
                    <label>
                      Where it meets {next!.id}
                      <select value={panel.crease} onChange={(event) => onChange(setTopPanel(config, surface.id, { crease: event.target.value === "none" ? undefined : event.target.value }))}>
                        <option value="none">Not joined</option>
                        <option value="screws">Screwed through a flange</option>
                      </select>
                    </label>
                  ) : null}
                  {panel.splits.length ? (
                    <label>
                      Where it splits
                      <select value={panel.joint} onChange={(event) => onChange(setTopPanel(config, surface.id, { joint: event.target.value === "tongue" ? undefined : event.target.value }))}>
                        <option value="tongue">Tongue and groove</option>
                        <option value="flat">Flat</option>
                      </select>
                    </label>
                  ) : null}
                </div>
              ) : null}
              {e.surfaces.length > 1 ? (
                <button className="danger" onClick={() => onChange(removeSurface(config, surface.id))}>Remove {surface.id}</button>
              ) : null}
            </div>
          );
        })}
        <button data-tutorial="add-surface" onClick={() => onChange(addSurface(config))}>Add a surface</button>
      </section>

      <section>
        <h2>Edges</h2>
        <div className="fields">
          <NumberField label="Corner radius" field="enclosure.cornerRadius" value={e.cornerRadius} onCommit={number((cornerRadius) => updateEnclosure(config, { cornerRadius }))} />
          <NumberField label="Front bottom round" field="enclosure.rounds.frontBottom" value={e.rounds.frontBottom} onCommit={number((radius) => setRound(config, "frontBottom", radius))} />
          <NumberField label="Rear top round" field="enclosure.rounds.rearTop" value={e.rounds.rearTop} onCommit={number((radius) => setRound(config, "rearTop", radius))} />
          <NumberField label="Rear bottom round" field="enclosure.rounds.rearBottom" value={e.rounds.rearBottom} onCommit={number((radius) => setRound(config, "rearBottom", radius))} />
          <NumberField label="Front wall bow" field="enclosure.bow.front" value={e.bow.front} onCommit={number((bow) => setBow(config, "front", bow))} />
          <NumberField label="Rear wall bow" field="enclosure.bow.rear" value={e.bow.rear} onCommit={number((bow) => setBow(config, "rear", bow))} />
        </div>
      </section>

      <section {...card(WALLS_PATH, "walls")}>
        <h2>Walls</h2>
        <div className="fields">
          <NumberField label="Wall" field="enclosure.wall" value={e.wall} step={0.1} onCommit={number((wall) => updateEnclosure(config, { wall }))} />
          <NumberField label="Top" field="enclosure.panelThickness" value={e.panelThickness} step={0.1} onCommit={number((panelThickness) => updateEnclosure(config, { panelThickness }))} />
          <NumberField label="Floor" field="enclosure.floorThickness" value={e.floorThickness} step={0.1} onCommit={number((floorThickness) => updateEnclosure(config, { floorThickness }))} />
          <ColorField label="Colour" value={e.color} onCommit={(color) => onChange(updateEnclosure(config, { color }))} />
        </div>
      </section>

      <section>
        <h2>Holes in the walls <span className="count">{wallHoles.length}</span></h2>
        <p className="hint">A board with a connector makes its own hole when it's against the wall.</p>
        {wallHoles.map((hole, index) => (
          <div {...card(`wallHoles[${index}]`)} key={index}>
            <div className="fields">
              <label>
                Wall
                <select value={hole.wall} onChange={(event) => onChange(updateWallHole(config, index, { wall: event.target.value }))}>
                  {WALLS.map((wall) => <option key={wall} value={wall}>{wall}</option>)}
                </select>
              </label>
              <NumberField label={hole.wall === "left" || hole.wall === "right" ? "Centre y" : "Centre x"} value={hole.at} onCommit={number((at) => updateWallHole(config, index, { at }))} />
              <NumberField label="Centre height" value={hole.z} onCommit={number((z) => updateWallHole(config, index, { z }))} />
              <NumberField label="Width" value={hole.width} onCommit={number((width) => updateWallHole(config, index, { width }))} />
              <NumberField label="Height" value={hole.height} onCommit={number((height) => updateWallHole(config, index, { height }))} />
              <NumberField label="Corner radius" value={hole.cornerRadius} onCommit={number((cornerRadius) => updateWallHole(config, index, { cornerRadius }))} />
            </div>
            <button className="danger" onClick={() => onChange(removeWallHole(config, index))}>Remove hole</button>
          </div>
        ))}
        <button onClick={() => place(PLACING.wallHole)}>Add a hole</button>
      </section>

      <section>
        <h2>Vents <span className="count">{vents.length}</span></h2>
        <p className="hint">A row of slots through a wall, for air, as many as fit its width.</p>
        {vents.map((vent, index) => (
          <div {...card(`vents[${index}]`)} key={index}>
            <div className="fields">
              <label>
                Wall
                <select value={vent.wall} onChange={(event) => onChange(updateVent(config, index, { wall: event.target.value }))}>
                  {WALLS.map((wall) => <option key={wall} value={wall}>{wall}</option>)}
                </select>
              </label>
              <NumberField label={vent.wall === "left" || vent.wall === "right" ? "Centre y" : "Centre x"} value={vent.at} onCommit={number((at) => updateVent(config, index, { at }))} />
              <NumberField label="Centre height" value={vent.z} onCommit={number((z) => updateVent(config, index, { z }))} />
              <NumberField label="Width" value={vent.width} onCommit={number((width) => updateVent(config, index, { width }))} />
              <NumberField label="Height" value={vent.height} onCommit={number((height) => updateVent(config, index, { height }))} />
              <NumberField label="Slot width" value={vent.slotWidth ?? 2} onCommit={number((slotWidth) => updateVent(config, index, { slotWidth }))} />
              <NumberField label="Gap between slots" value={vent.gap ?? 2} onCommit={number((gap) => updateVent(config, index, { gap }))} />
            </div>
            <button className="danger" onClick={() => onChange(removeVent(config, index))}>Remove vent</button>
          </div>
        ))}
        <button onClick={() => place(PLACING.vent)}>Add a vent</button>
      </section>

      <section>
        <h2>Labels <span className="count">{labels.length}</span></h2>
        <p className="hint">Engraved, in capitals. A part's own label is on the Layout tab, and moves with it.</p>
        {labels.map((label, index) => (
          <div {...card(`labels[${index}]`)} key={index}>
            <div className="fields">
              <TextField label="Text" value={label.text} onCommit={(text) => onChange(updateLabel(config, index, { text }))} />
              <NumberField label="Size" value={label.size ?? 5} onCommit={number((size) => updateLabel(config, index, { size }))} />
              <NumberField label="Depth" value={label.depth ?? 0.6} step={0.2} onCommit={number((depth) => updateLabel(config, index, { depth }))} />
              <label className="check">
                <input type="checkbox" checked={Boolean(label.color)} onChange={(event) => onChange(updateLabel(config, index, { color: event.target.checked ? "#f2f2f2" : undefined }))} />
                Inlaid in a second colour
              </label>
              {label.color ? <ColorField label="Inlay colour" value={label.color} onCommit={(color) => onChange(updateLabel(config, index, { color }))} /> : null}
              {"component" in label ? (
                <label>
                  Beside {label.component}
                  <select value={label.side ?? "below"} onChange={(event) => onChange(updateLabel(config, index, { side: event.target.value }))}>
                    {LABEL_SIDES.map((side) => <option key={side} value={side}>{side}</option>)}
                  </select>
                </label>
              ) : "wall" in label ? (
                <>
                  <label>
                    Wall
                    <select value={label.wall} onChange={(event) => onChange(updateLabel(config, index, { wall: event.target.value }))}>
                      {WALLS.map((wall) => <option key={wall} value={wall}>{wall}</option>)}
                    </select>
                  </label>
                  <NumberField label={label.wall === "left" || label.wall === "right" ? "Centre y" : "Centre x"} value={label.at} onCommit={number((at) => updateLabel(config, index, { at }))} />
                  <NumberField label="Centre height" value={label.z} onCommit={number((z) => updateLabel(config, index, { z }))} />
                </>
              ) : (
                <>
                  <label>
                    Surface
                    <select value={label.surface ?? e.surfaces[0]?.id} onChange={(event) => onChange(updateLabel(config, index, { surface: event.target.value }))}>
                      {e.surfaces.map((surface) => <option key={surface.id} value={surface.id}>{surface.id}</option>)}
                    </select>
                  </label>
                  <NumberField label="Across (u)" value={label.u} onCommit={number((u) => updateLabel(config, index, { u }))} />
                  <NumberField label="Back (v)" value={label.v} onCommit={number((v) => updateLabel(config, index, { v }))} />
                </>
              )}
              {"component" in label ? null : (
                <label>
                  Turn
                  <select value={String(label.rotationDeg ?? 0)} onChange={(event) => onChange(updateLabel(config, index, { rotationDeg: Number(event.target.value) }))}>
                    {[0, 90, 180, 270].map((turn) => <option key={turn} value={String(turn)}>{turn}°</option>)}
                  </select>
                </label>
              )}
            </div>
            <button className="danger" onClick={() => onChange(removeLabel(config, index))}>Remove label</button>
          </div>
        ))}
        <div className="row">
          <button onClick={() => place(PLACING.surfaceLabel)}>Add to a surface</button>
          <button onClick={() => place(PLACING.wallLabel)}>Add to a wall</button>
        </div>
      </section>

      <section>
        <h2>Opening</h2>
        <label className="check">
          <input type="checkbox" checked={opening !== undefined} onChange={(event) => onChange(setOpening(config, event.target.checked))} />
          Cut an opening through the front and top
        </label>
        {opening ? (
          <>
            <p className="hint">A gap for something that reaches out of the enclosure. Below the sill the front wall stays, unless a rail replaces it.</p>
            <div {...card("opening", "fields")}>
              <NumberField label="From x" value={opening.xMin} onCommit={number((xMin) => updateOpening(config, { xMin }))} />
              <NumberField label="To x" value={opening.xMax} onCommit={number((xMax) => updateOpening(config, { xMax }))} />
              <NumberField label="Back to depth" value={opening.yEnd} onCommit={number((yEnd) => updateOpening(config, { yEnd }))} />
              <NumberField label="Sill height" value={opening.sill} onCommit={number((sill) => updateOpening(config, { sill }))} />
            </div>

            <label className="check">
              <input type="checkbox" checked={opening.rail !== undefined} onChange={(event) => onChange(setRail(config, event.target.checked))} />
              Add a removable rail below it
            </label>
            {opening.rail ? (
              <div className="fields">
                <NumberField label="Rail depth" value={opening.rail.depth} onCommit={number((depth) => updateRail(config, { depth }))} />
                <NumberField label="Foot height" value={opening.rail.footHeight ?? 2} onCommit={number((footHeight) => updateRail(config, { footHeight }))} />
                <NumberField label="Left screw x" value={opening.rail.screwX[0]} onCommit={number((x) => setRailScrew(config, 0, x))} />
                <NumberField label="Right screw x" value={opening.rail.screwX[1]} onCommit={number((x) => setRailScrew(config, 1, x))} />
                <ColorField label="Colour" value={opening.rail.color ?? e.color} onCommit={(color) => onChange(updateRail(config, { color }))} />
              </div>
            ) : null}

            <h2>Room its contents need <span className="count">{opening.keepOut.length}</span></h2>
            <p className="hint">Boxes from the base up, which screws and parts stay out of. "Show inside" draws them. Use as many as its shape needs.</p>
            {opening.keepOut.map((box, index) => (
              <div {...card(`opening.keepOut[${index}]`)} key={index}>
                <div className="fields">
                  <NumberField label="From x" value={box.xMin} onCommit={number((xMin) => updateReservedRoom(config, index, { xMin }))} />
                  <NumberField label="To x" value={box.xMax} onCommit={number((xMax) => updateReservedRoom(config, index, { xMax }))} />
                  <NumberField label="From y" value={box.yMin} onCommit={number((yMin) => updateReservedRoom(config, index, { yMin }))} />
                  <NumberField label="To y" value={box.yMax} onCommit={number((yMax) => updateReservedRoom(config, index, { yMax }))} />
                  <NumberField label="Up to height" value={box.top} onCommit={number((top) => updateReservedRoom(config, index, { top }))} />
                </div>
                <button className="danger" onClick={() => onChange(removeReservedRoom(config, index))}>Remove box</button>
              </div>
            ))}
            <button onClick={() => onChange(addReservedRoom(config))}>Add a box</button>
          </>
        ) : null}
      </section>

      <section>
        <h2>Fixings on the plate <span className="count">{plate.countersunkHoles.length + plate.pins.length + cableTies.length + plate.supports.length}</span></h2>
        <p className="hint">For mounting something inside: a hole takes a screw from below, a pin locates it from above, and a bridge holds wires with a cable tie. A support rises to just under the top, to hold up a wide stretch of it.</p>
        {plate.countersunkHoles.map((hole, index) => (
          <div {...card(`plate.countersunkHoles[${index}]`)} key={index}>
            <div className="fields">
              <NumberField label="Hole x" value={hole.x} onCommit={number((x) => updatePlateHole(config, index, { x }))} />
              <NumberField label="Hole y" value={hole.y} onCommit={number((y) => updatePlateHole(config, index, { y }))} />
            </div>
            <button className="danger" onClick={() => onChange(removePlateHole(config, index))}>Remove hole</button>
          </div>
        ))}
        {plate.pins.map((pin, index) => (
          <div {...card(`plate.pins[${index}]`)} key={index}>
            <div className="fields">
              <NumberField label="Pin x" value={pin.x} onCommit={number((x) => updatePlatePin(config, index, { x }))} />
              <NumberField label="Pin y" value={pin.y} onCommit={number((y) => updatePlatePin(config, index, { y }))} />
              <NumberField label="Diameter" value={pin.diameter} step={0.1} onCommit={number((diameter) => updatePlatePin(config, index, { diameter }))} />
              <NumberField label="Height" value={pin.height} step={0.1} onCommit={number((height) => updatePlatePin(config, index, { height }))} />
              <TextField label="Tip diameter" placeholder="None" value={pin.tipDiameter === undefined ? "" : String(pin.tipDiameter)} onCommit={optional((tipDiameter) => updatePlatePin(config, index, { tipDiameter }))} />
              <TextField label="Tip height" placeholder="None" value={pin.tipHeight === undefined ? "" : String(pin.tipHeight)} onCommit={optional((tipHeight) => updatePlatePin(config, index, { tipHeight }))} />
            </div>
            <button className="danger" onClick={() => onChange(removePlatePin(config, index))}>Remove pin</button>
          </div>
        ))}
        {cableTies.map((tie, index) => (
          <div {...card(`plate.cableTies[${index}]`)} key={index}>
            <div className="fields">
              <NumberField label="Bridge x" value={tie.x} onCommit={number((x) => updateCableTie(config, index, { x }))} />
              <NumberField label="Bridge y" value={tie.y} onCommit={number((y) => updateCableTie(config, index, { y }))} />
              <label>
                Tie runs
                <select value={String(tie.rotationDeg ?? 0)} onChange={(event) => onChange(updateCableTie(config, index, { rotationDeg: Number(event.target.value) }))}>
                  <option value="0">Front to back</option>
                  <option value="90">Side to side</option>
                </select>
              </label>
            </div>
            <button className="danger" onClick={() => onChange(removeCableTie(config, index))}>Remove bridge</button>
          </div>
        ))}
        {plate.supports.map((support, index) => (
          <div {...card(`plate.supports[${index}]`)} key={index}>
            <div className="fields">
              <NumberField label="Support x" value={support.x} onCommit={number((x) => updateSupport(config, index, { x }))} />
              <NumberField label="Support y" value={support.y} onCommit={number((y) => updateSupport(config, index, { y }))} />
              <NumberField label="Diameter" value={support.diameter} step={0.5} onCommit={number((diameter) => updateSupport(config, index, { diameter }))} />
            </div>
            <button className="danger" onClick={() => onChange(removeSupport(config, index))}>Remove support</button>
          </div>
        ))}
        <div className="row">
          <button onClick={() => place(PLACING.plateHole)}>Add a hole</button>
          <button onClick={() => place(PLACING.platePin)}>Add a pin</button>
          <button onClick={() => place(PLACING.cableTie)}>Add a cable tie bridge</button>
          <button onClick={() => place(PLACING.support)}>Add a support</button>
        </div>
      </section>

      <section>
        <h2>Weight pockets <span className="count">{plate.weights.length}</span></h2>
        <p className="hint">A walled pocket on the plate, this size inside, to glue a weight into, such as steel, so that it doesn't slide.</p>
        {plate.weights.map((weight, index) => (
          <div {...card(`plate.weights[${index}]`)} key={index}>
            <div className="fields">
              <NumberField label="Pocket x" value={weight.x} onCommit={number((x) => updateWeight(config, index, { x }))} />
              <NumberField label="Pocket y" value={weight.y} onCommit={number((y) => updateWeight(config, index, { y }))} />
              <NumberField label="Width" value={weight.width} onCommit={number((width) => updateWeight(config, index, { width }))} />
              <NumberField label="Depth" value={weight.depth} onCommit={number((depth) => updateWeight(config, index, { depth }))} />
              <NumberField label="Height" value={weight.height} onCommit={number((height) => updateWeight(config, index, { height }))} />
            </div>
            <button className="danger" onClick={() => onChange(removeWeight(config, index))}>Remove pocket</button>
          </div>
        ))}
        <div className="row">
          <button onClick={() => place(PLACING.weight)}>Add a weight pocket</button>
        </div>
      </section>

      <section>
        <h2>Rubber feet <span className="count">{plate.feet.length}</span></h2>
        <p className="hint">A shallow recess under the plate for each stick-on foot, so they all go in the same place.</p>
        {plate.feet.map((foot, index) => (
          <div {...card(`plate.feet[${index}]`)} key={index}>
            <div className="fields">
              <NumberField label="Foot x" value={foot.x} onCommit={number((x) => updateFoot(config, index, { x }))} />
              <NumberField label="Foot y" value={foot.y} onCommit={number((y) => updateFoot(config, index, { y }))} />
              <NumberField label="Diameter" value={foot.diameter} step={0.5} onCommit={number((diameter) => updateFoot(config, index, { diameter }))} />
            </div>
            <button className="danger" onClick={() => onChange(removeFoot(config, index))}>Remove foot</button>
          </div>
        ))}
        <div className="row">
          <button onClick={() => onChange(feetAtCorners(config))}>Put four at the corners</button>
          <button onClick={() => place(PLACING.foot)}>Add a foot</button>
        </div>
      </section>

      <section>
        <h2>Wiring</h2>
        <p className="hint">For the pin count on the Print tab. Shift registers that read switches, on a board of your own rather than parts of their own, like the Desk Synth's perfboard.</p>
        <div className="fields">
          <NumberField label="Shift registers" value={config.wiring?.shiftRegisters ?? 0} step={1} onCommit={number((count) => setShiftRegisters(config, count))} />
        </div>
        <label className="check">
          <input type="checkbox" checked={config.wiring?.checks !== false} onChange={(event) => onChange(setWiringChecks(config, event.target.checked))} />
          Warn about room for wires
        </label>
        <p className="hint">Each part keeps room where its wires leave it, and they're routed across the floor to the board they go to, shown with Wires in the view. The parts' plugs are estimates, so this only ever warns, and it's off with this unticked.</p>
        <div className="row">
          <button onClick={() => onChange(tiesAlongWires(config))}>Add cable tie bridges along the wires</button>
        </div>
      </section>

      <section>
        <h2>Printer</h2>
        <div className="fields">
          <label>
            Material
            <select value={fabrication.material} onChange={(event) => onChange(updateFabrication(config, { material: event.target.value }))}>
              <option value="PETG">PETG</option>
              <option value="PETG-GF">PETG-GF</option>
            </select>
          </label>
          <NumberField label="Bed x" value={fabrication.buildVolume.x} onCommit={number((size) => setBed(config, "x", size))} />
          <NumberField label="Bed y" value={fabrication.buildVolume.y} onCommit={number((size) => setBed(config, "y", size))} />
          <NumberField label="Bed z" value={fabrication.buildVolume.z} onCommit={number((size) => setBed(config, "z", size))} />
        </div>
        <label className="check" data-tutorial="seam">
          <input type="checkbox" checked={seams.length > 0} onChange={(event) => onChange(setSeam(config, event.target.checked ? e.width / 2 : null))} />
          Split the shell into pieces, for a small bed
        </label>
        {seams.map((seam, index) => (
          <div {...card(`seams[${index}]`, "fields")} key={index}>
            <NumberField label={seams.length > 1 ? `Seam ${index + 1} at x` : "Split at x"} value={seam.x} onCommit={number((x) => updateSeam(config, index, { x }))} />
            <NumberField label="Lip past it" field={`seams[${index}].lip`} value={seam.lip} onCommit={number((lip) => updateSeam(config, index, { lip }))} />
            <NumberField label="Tongue past it" field={`seams[${index}].tongue`} value={seam.tongue ?? 0} onCommit={number((tongue) => updateSeam(config, index, { tongue }))} />
            <label className="check" title="Tabs from the left piece over blocks on the right one's rear wall, each held by a screw driven from the front into an insert, in place of the bolted rib there.">
              <input type="checkbox" checked={Boolean(seam.keys)} onChange={(event) => onChange(updateSeam(config, index, { keys: event.target.checked }))} />
              Keys on the rear wall
            </label>
            {seams.length > 1 ? <button className="danger" onClick={() => onChange(removeSeam(config, index))}>Remove seam</button> : null}
          </div>
        ))}
        {seams.length ? (
          <>
            <p className="hint">A lip hides the joint and lines the pieces up: the left piece's outer skin reaches this far over a step in the right one. A tongue lines them up instead, as the real Desk Synth's seam does: the middle third of the skin reaches this far into a groove, which needs walls about 4.2 mm thick. Use one or the other. 0 leaves it flat. Keys swap the bolted rib on the rear wall for the real one's screwed keys.</p>
            <button onClick={() => place(PLACING.seam)}>Add a seam</button>
          </>
        ) : null}
        <div {...card("plate.seamX", "fields")}>
          <TextField
            label="Split the plate at x"
            placeholder="Automatic"
            value={plate.seamX === undefined ? "" : [plate.seamX].flat().join(", ")}
            onCommit={(text) => {
              if (text.trim() === "") onChange(setPlateSplit(config, null));
              const joints = parseSplits(text);
              if (joints?.length) onChange(setPlateSplit(config, joints));
            }}
          />
          <label>
            Where the plate splits
            <select value={plate.joint} onChange={(event) => onChange(setPlateJoint(config, event.target.value as "flat" | "rib"))}>
              <option value="flat">Each piece screws to the shell</option>
              <option value="rib">A rib bolts the pieces together</option>
            </select>
          </label>
        </div>
      </section>

      <p className="hint">All sizes are in millimetres. Depth is y from the front, and height is z from the base. Screws are on the Screws tab.</p>
    </div>
  );
}
