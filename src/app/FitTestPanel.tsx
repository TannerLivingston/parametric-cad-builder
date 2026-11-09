// A small print of the design's own holes and clips in a range of sizes. Choosing the size that
// fits writes it into the config, so the next build uses it.
import { useMemo, useState } from "react";
import { fitStepSize, fitTestPieces, planFitTest, type FitRow, type FitTestPlan } from "../fitTest.js";
import { library } from "../library.js";
import { fitTestable, type BuildPlan } from "../validate.js";
import type { RawConfig } from "./configEdit.js";
import { NumberField } from "./fields.js";
import { applyFit, setFitTestParts } from "./fitEdit.js";
import { applyProfile, loadProfile, mergeProfile, profileDifferences, profileFromConfig, profileSummary, saveProfile } from "./printerProfile.js";

interface FitTestPanelProps {
  config: RawConfig;
  plan: BuildPlan;
  showing: boolean;
  onShow(plan: FitTestPlan | null): void;
  onExport(plan: FitTestPlan, index: number, name: string, format: "stl" | "step"): void;
  onChange(config: RawConfig): void;
}

const dots = (count: number) => `${count} ${count === 1 ? "dot" : "dots"}`;

function RowChoice({ row, onPick }: { row: FitRow; onPick(value: number): void }) {
  if (row.steps.length === 1) {
    return <NumberField label="Add to its holes, in mm" step={0.05} value={row.current} onCommit={(text) => text !== "" && Number.isFinite(Number(text)) && onPick(Number(text))} />;
  }
  return (
    <label>
      The one that fits
      <select value={String(row.current)} onChange={(event) => onPick(Number(event.target.value))}>
        {row.steps.map((step) => <option key={step.pips} value={String(step.value)}>{dots(step.pips)}: {fitStepSize(row, step)}</option>)}
      </select>
    </label>
  );
}

export function FitTestPanel({ config, plan, showing, onShow, onExport, onChange }: FitTestPanelProps) {
  const test = useMemo(() => planFitTest(plan), [plan]);
  const [profile, setProfile] = useState(loadProfile);
  if (test.rows.length === 0) return null;
  const differences = profile ? profileDifferences(config, profile) : [];
  const allParts = { ...library, ...plan.config.customParts };
  const trying = plan.config.fabrication.fitTestParts;
  const placed = plan.config.components.map((component) => component.type);
  const canTry = Object.entries(allParts).filter(([id, part]) => fitTestable(part) && !trying.includes(id) && !placed.includes(id));
  const save = () => {
    const next = mergeProfile(profile, profileFromConfig(config));
    saveProfile(next);
    setProfile(next);
  };
  return (
    <section className="fit-test" aria-label="Fit test">
      <h2>Fit test</h2>
      <p className="hint">Nothing here has been checked on your printer yet. Print this first, with the same material and settings as the real parts, then pick what fits. It has what this design uses, and any others you add below.</p>
      <div className="row">
        <button onClick={() => onShow(showing ? null : test)}>{showing ? "Back to the design" : "Show it"}</button>
      </div>
      {fitTestPieces(test).map((name, index) => (
        <div className="row print-part" key={name}>
          <span className="print-name">{name}</span>
          <button onClick={() => onExport(test, index, name, "stl")}>STL</button>
          <button onClick={() => onExport(test, index, name, "step")}>STEP</button>
        </div>
      ))}
      <p className="hint">Print each piece as exported. The first is the fixings every design needs, and is the one to start with. You'll need: {test.hardware.join("; ")}. Dots in the left margin number the rows, and dots behind each hole number its size.</p>
      {test.rows.map((row) => (
        <div className="fit-row" key={row.number}>
          <h3>Row {row.number}: {row.title}</h3>
          <p className="hint">{row.how}</p>
          <RowChoice row={row} onPick={(value) => onChange(applyFit(config, row, value))} />
        </div>
      ))}
      <div className="fit-row">
        <h3>Parts to try</h3>
        <p className="hint">Adds a part this design doesn't use, to test it for later. Its row goes last, so the others keep their numbers.</p>
        {trying.map((id) => (
          <div className="row print-part" key={id}>
            <span className="print-name">{allParts[id]?.name ?? id}</span>
            <button onClick={() => onChange(setFitTestParts(config, trying.filter((other) => other !== id)))}>Remove</button>
          </div>
        ))}
        <label>
          Add a part
          <select value="" onChange={(event) => event.target.value && onChange(setFitTestParts(config, [...trying, event.target.value]))}>
            <option value="">Choose one</option>
            {canTry.map(([id, part]) => <option key={id} value={id}>{part.name}</option>)}
          </select>
        </label>
      </div>
      <div className="fit-row">
        <h3>Your printer</h3>
        {profile ? (
          <p className="hint">Saved: {profileSummary(profile).join(", ") || "the usual sizes"}. New designs start with these.</p>
        ) : (
          <p className="hint">Once these fit, save them for your printer, and new designs will start with them.</p>
        )}
        {differences.length ? <p className="hint">This design differs. {differences.join(". ")}.</p> : null}
        <div className="row">
          <button onClick={save}>Save these for my printer</button>
          {profile && differences.length ? <button onClick={() => onChange(applyProfile(config, profile))}>Use my printer's sizes</button> : null}
        </div>
      </div>
      {test.wallSection ? (
        <div className="fit-row">
          <h3>Wall section</h3>
          <p className="hint">A corner of the real shell, cut from it and printed the same way up, so there's nothing to pick. See that the rounds come out smoothly and the layers hold, and that the wall measures {test.wallSection.wall} mm. Use the supports the shell will use.</p>
        </div>
      ) : null}
      {test.seamJoint ? (
        <div className="fit-row">
          <h3>Seam joint</h3>
          <p className="hint">Slices of the real seam, one from each half, printed the same way up. Press in the insert, bolt them together with the real bolt, and see that they line up flush and the driver reaches. If the pin is the trouble, the row above sets its socket.</p>
        </div>
      ) : null}
      <p className="hint">Not covered yet: pins on the plate, and the holes in a board's standoffs.</p>
    </section>
  );
}
