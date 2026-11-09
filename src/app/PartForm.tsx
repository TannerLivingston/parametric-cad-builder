// A part the library doesn't have: its holes with a body above and below them, or a board on the
// floor. Its sizes are the part's own, so the validator can check it like any other.
import { useState } from "react";
import type { Footprint, Part } from "../schema.js";
import { NumberField, TextField } from "./fields.js";
import { partFromDraft, type PartDraft } from "./shapeEdit.js";

function FootprintFields({ label, value, onChange, children }: { label: string; value: Footprint; onChange(next: Footprint): void; children?: React.ReactNode }) {
  const size = (apply: (n: number) => Footprint) => (text: string) => {
    const n = Number(text);
    if (text !== "" && Number.isFinite(n)) onChange(apply(n));
  };
  return (
    <fieldset className="fields">
      <legend>{label}</legend>
      <label>
        Shape
        <select
          value={value.shape}
          onChange={(event) => {
            if (event.target.value === value.shape) return;
            onChange(value.shape === "circle" ? { shape: "rect", width: value.diameter, height: value.diameter } : { shape: "circle", diameter: value.width });
          }}
        >
          <option value="circle">Round</option>
          <option value="rect">Rectangle</option>
        </select>
      </label>
      {value.shape === "circle" ? (
        <NumberField label="Diameter" value={value.diameter} onCommit={size((diameter) => ({ shape: "circle", diameter }))} />
      ) : (
        <>
          <NumberField label="Width" value={value.width} onCommit={size((width) => ({ ...value, width }))} />
          <NumberField label="Length" value={value.height} onCommit={size((height) => ({ ...value, height }))} />
        </>
      )}
      {children}
    </fieldset>
  );
}

function OffsetFields({ at, onChange }: { at: [number, number]; onChange(at: [number, number]): void }) {
  const offset = (axis: 0 | 1) => (text: string) => {
    const n = Number(text);
    if (text !== "" && Number.isFinite(n)) onChange(axis === 0 ? [n, at[1]] : [at[0], n]);
  };
  return (
    <>
      <NumberField label="Across" value={at[0]} onCommit={offset(0)} />
      <NumberField label="Along" value={at[1]} onCommit={offset(1)} />
    </>
  );
}

export function PartForm({ initial, existing, onSave, onDelete, onCancel }: { initial: PartDraft; existing?: Part; onSave(part: Part): void; onDelete?(): void; onCancel(): void }) {
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const change = (patch: Partial<PartDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setProblem(null);
  };
  const size = (apply: (n: number) => Partial<PartDraft>) => (text: string) => {
    const n = Number(text);
    if (text !== "" && Number.isFinite(n)) change(apply(n));
  };
  const save = () => {
    const result = partFromDraft(draft, existing);
    if (result.ok) onSave(result.part);
    else setProblem(result.message);
  };

  return (
    <section className="inspector part-form" aria-label={existing ? "Edit custom part" : "New custom part"}>
      <h2>{existing ? "Edit part" : "New part"}</h2>
      <div className="fields">
        <TextField label="Name" value={draft.name} onCommit={(name) => change({ name })} />
      </div>
      <div className="fields">
        <label>
          Goes
          <select value={draft.mount} onChange={(event) => change({ mount: event.target.value as PartDraft["mount"] })}>
            <option value="panel">Through the top</option>
            <option value="floor">On the floor</option>
          </select>
        </label>
        <label>
          These sizes are
          <select value={draft.source} onChange={(event) => change({ source: event.target.value as Part["source"] })}>
            <option value="measured">Measured</option>
            <option value="datasheet">From a datasheet</option>
            <option value="estimated">Estimated</option>
          </select>
        </label>
      </div>
      {draft.mount === "panel" ? (
        <>
          <FootprintFields label={draft.moreHoles.length ? "Hole 1" : "Hole"} value={draft.hole} onChange={(hole) => change({ hole })}>
            {draft.moreHoles.length ? <OffsetFields at={draft.holeAt} onChange={(holeAt) => change({ holeAt })} /> : null}
          </FootprintFields>
          {draft.moreHoles.map((item, index) => (
            <div key={index}>
              <FootprintFields label={`Hole ${index + 2}`} value={item.hole} onChange={(hole) => change({ moreHoles: draft.moreHoles.map((other, i) => (i === index ? { ...other, hole } : other)) })}>
                <OffsetFields at={item.at} onChange={(at) => change({ moreHoles: draft.moreHoles.map((other, i) => (i === index ? { ...other, at } : other)) })} />
              </FootprintFields>
              <button className="danger" onClick={() => change({ moreHoles: draft.moreHoles.filter((_, i) => i !== index) })}>Remove this hole</button>
            </div>
          ))}
          <div className="row">
            <button onClick={() => change({ moreHoles: [...draft.moreHoles, { hole: draft.hole, at: [draft.holeAt[0] + 20, draft.holeAt[1]] }] })}>Add another hole</button>
          </div>
          {draft.moreHoles.length ? <p className="hint">Each hole's offset is from the part's centre, which is where it's placed from.</p> : null}
          <FootprintFields label="Above the top, such as a knob or bezel" value={draft.above} onChange={(above) => change({ above })}>
            <NumberField label="Height" value={draft.aboveHeight} onCommit={size((aboveHeight) => ({ aboveHeight }))} />
          </FootprintFields>
          <FootprintFields label="Below the top" value={draft.below} onChange={(below) => change({ below })}>
            <NumberField label="Depth" value={draft.belowDepth} onCommit={size((belowDepth) => ({ belowDepth }))} />
          </FootprintFields>
        </>
      ) : (
        <FootprintFields label="Footprint" value={draft.footprint} onChange={(footprint) => change({ footprint })}>
          <NumberField label="Height" value={draft.height} onCommit={size((height) => ({ height }))} />
        </FootprintFields>
      )}
      {problem ? <p className="danger note">{problem}</p> : null}
      <div className="row">
        <button onClick={save}>{existing ? "Save" : "Create and add"}</button>
        <button onClick={onCancel}>Cancel</button>
        {onDelete ? <button className="danger" onClick={onDelete}>Delete part</button> : null}
      </div>
    </section>
  );
}
