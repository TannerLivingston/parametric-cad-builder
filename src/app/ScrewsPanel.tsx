// The screws the validator placed, for changing where it got them wrong. It only writes
// changes into the config, so anything left alone keeps adapting to the design.
import type { PlannedFastener, PlannedFasteners } from "../validate.js";
import type { RawConfig } from "./configEdit.js";
import { addFastener, hasFastenerChanges, moveFastener, removedFasteners, removeFastener, resetFasteners, restoreRemoved } from "./fastenerEdit.js";
import { NumberField } from "./fields.js";

interface ScrewsPanelProps {
  config: RawConfig;
  fasteners: PlannedFasteners;
  selected: string | null;
  dragProblem: string | null;
  onSelect(id: string | null): void;
  onChange(config: RawConfig): void;
  onNotice(message: string): void;
}

const mm = (value: number) => `${Math.round(value * 10) / 10}`;

function describe(item: PlannedFastener) {
  if (item.kind === "plate") return "Plate screw";
  return `Top screw, ${item.surface}, ${item.wall} edge`;
}

export function ScrewsPanel({ config, fasteners, selected, dragProblem, onSelect, onChange, onNotice }: ScrewsPanelProps) {
  const item = fasteners.items.find((f) => f.id === selected);
  const groups: { surface: string | null; name: string }[] = [
    ...(config.plate?.enabled === false ? [] : [{ surface: null, name: "Plate" }]),
    ...(config.topPanels ?? []).map((panel: any) => ({ surface: panel.surface as string, name: `Top panel: ${panel.surface}` })),
  ];
  const countOf = (surface: string | null) => fasteners.items.filter((f) => f.surface === surface).length;

  const add = (surface: string | null) => {
    const added = addFastener(config, fasteners, surface);
    if (!added) {
      onNotice("There's no free spot along those edges. Move something out of the way, or move a screw by dragging it.");
      return;
    }
    onChange(added.config);
    onSelect(added.id);
  };

  const move = (x: number, y: number) => {
    const moved = moveFastener(config, item!, x, y);
    onChange(moved.config);
    onSelect(moved.id);
  };
  const number = (apply: (value: number) => void) => (text: string) => {
    if (text !== "" && Number.isFinite(Number(text))) apply(Number(text));
  };

  return (
    <div className="tab-body shape-form">
      <p className="hint">Screws place themselves around your parts, and each one here has a brass insert. Drag one to move it, or change only the ones you need to. The rest keep adapting.</p>
      <ul className="screw-legend">
        <li><span className="dot auto" aria-hidden="true" />Automatic</li>
        <li><span className="dot changed" aria-hidden="true" />Added by you</li>
        <li><span className="dot bad" aria-hidden="true" />Can't go there</li>
      </ul>

      {item ? (
        <section className="inspector" aria-label="Selected screw">
          <h2>{describe(item)}</h2>
          <p className="muted">{item.addedAt === null ? "Placed automatically. Moving it fixes it in place." : "Added by you, so it stays here."}</p>
          {dragProblem ?? item.problem ? <p className="danger note">It can't go there, because {dragProblem ?? item.problem}.</p> : null}
          <div className="fields">
            {item.kind === "plate" ? (
              <>
                <NumberField label="x" value={Number(mm(item.x))} onCommit={number((x) => move(x, item.y))} />
                <NumberField label="y" value={Number(mm(item.y))} onCommit={number((y) => move(item.x, y))} />
              </>
            ) : item.wall === "left" || item.wall === "right" ? (
              <NumberField label="Along the wall (y)" value={Number(mm(item.y))} onCommit={number((y) => move(item.x, y))} />
            ) : (
              <NumberField label="Along the wall (x)" value={Number(mm(item.x))} onCommit={number((x) => move(x, item.y))} />
            )}
          </div>
          <div className="row">
            <button
              className="danger"
              onClick={() => {
                onChange(removeFastener(config, item));
                onSelect(null);
              }}
            >
              Remove
            </button>
          </div>
        </section>
      ) : (
        <p className="hint empty">Select a screw in the view to move or remove it.</p>
      )}

      {groups.map(({ surface, name }) => {
        const removed = removedFasteners(config, surface);
        return (
          <section key={surface ?? "plate"}>
            <div className="row screw-row">
              <h2>{name} <span className="count">{countOf(surface)}</span></h2>
              <button onClick={() => add(surface)}>Add a screw</button>
            </div>
            {removed.map((spot, index) => (
              <div className="row screw-row" key={index}>
                <span className="muted note">Removed: {surface === null ? `x ${mm(spot.x)}, y ${mm(spot.y)}` : `${spot.wall} edge at ${mm(spot.at)}`}</span>
                <button onClick={() => onChange(restoreRemoved(config, surface, index))}>Restore</button>
              </div>
            ))}
          </section>
        );
      })}

      <button
        disabled={!hasFastenerChanges(config)}
        onClick={() => {
          onChange(groups.reduce((next, { surface }) => resetFasteners(next, surface), config));
          onSelect(null);
        }}
      >
        Put every screw back to automatic
      </button>
      <p className="hint">Seam bolts follow the seam. Rail screws are on the Shape tab, and the screws for a screen come with the part.</p>
    </div>
  );
}
