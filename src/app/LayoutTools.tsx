// Copying and lining up the selected part.
import { useState } from "react";
import type { RawComponent, RawConfig } from "./configEdit.js";
import { NumberField } from "./fields.js";
import { alignableWith, alignComponent, arrayComponent, centreComponent, MAX_COPIES, mirrorComponent } from "./layoutEdit.js";

interface LayoutToolsProps {
  config: RawConfig;
  component: RawComponent;
  onChange(config: RawConfig): void;
  onSelect(id: string): void;
}

export function LayoutTools({ config, component, onChange, onSelect }: LayoutToolsProps) {
  const [columns, setColumns] = useState(2);
  const [rows, setRows] = useState(1);
  const [stepAlong, setStepAlong] = useState(30);
  const [stepAcross, setStepAcross] = useState(30);
  const [target, setTarget] = useState("");
  const others = alignableWith(config, component.id);
  const chosen = others.includes(target) ? target : others[0];
  const number = (apply: (value: number) => void) => (text: string) => {
    if (text !== "" && Number.isFinite(Number(text))) apply(Number(text));
  };
  return (
    <div className="layout-tools">
      <div className="fields">
        <NumberField label="Across" value={columns} onCommit={number(setColumns)} />
        <NumberField label="Rows" value={rows} onCommit={number(setRows)} />
        <NumberField label="Spacing" value={stepAlong} onCommit={number(setStepAlong)} />
        <NumberField label="Row spacing" value={stepAcross} onCommit={number(setStepAcross)} />
      </div>
      <div className="row">
        <button
          disabled={columns * rows <= 1 || columns * rows > MAX_COPIES}
          onClick={() => onChange(arrayComponent(config, component.id, { columns, rows, stepAlong, stepAcross }).config)}
        >
          Make {Math.max(columns * rows - 1, 0)} {columns * rows === 2 ? "copy" : "copies"}
        </button>
        <button
          onClick={() => {
            const mirrored = mirrorComponent(config, component.id);
            if (!mirrored) return;
            onChange(mirrored.config);
            onSelect(mirrored.id);
          }}
        >
          Mirror
        </button>
        <button onClick={() => onChange(centreComponent(config, component.id))}>Centre</button>
      </div>
      {others.length ? (
        <div className="row">
          <label className="sr-only" htmlFor="align-target">Line up with</label>
          <select id="align-target" value={chosen} onChange={(event) => setTarget(event.target.value)}>
            {others.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
          <button onClick={() => onChange(alignComponent(config, component.id, chosen!, "row"))}>Same row</button>
          <button onClick={() => onChange(alignComponent(config, component.id, chosen!, "column"))}>Same column</button>
        </div>
      ) : null}
    </div>
  );
}
