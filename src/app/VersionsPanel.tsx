// Versions of the design kept by name, to go back to or compare with. Going back is one undoable
// step, so it can't lose anything.
import { useState } from "react";
import { addVersion, describeChange, loadVersions, saveVersions, type DesignVersion } from "./designHistory.js";

interface VersionsPanelProps {
  text: string;
  onRestore(text: string, name: string): void;
}

export function VersionsPanel({ text, onRestore }: VersionsPanelProps) {
  const [versions, setVersions] = useState<DesignVersion[]>(loadVersions);
  const [name, setName] = useState("");
  const [failed, setFailed] = useState(false);
  const change = (next: DesignVersion[]) => {
    setVersions(next);
    setFailed(!saveVersions(next));
  };
  return (
    <section aria-label="Versions">
      <h2>Versions <span className="count">{versions.length}</span></h2>
      <p className="hint">Kept in this browser. Save the file too, for anything you can't lose.</p>
      <div className="row">
        <input type="text" aria-label="Version name" placeholder="Name, such as before the second print" value={name} onChange={(event) => setName(event.target.value)} />
        <button
          onClick={() => {
            change(addVersion(versions, name, text, new Date()));
            setName("");
          }}
        >
          Keep this version
        </button>
      </div>
      {failed ? <p className="hint">This browser wouldn't store it, so it'll be gone after a reload. Save the file instead.</p> : null}
      {versions.map((version) => (
        <div className="surface-card" key={version.name}>
          <strong>{version.name}</strong>
          <p className="muted note">{new Date(version.savedAt).toLocaleString()}. {describeChange(text, version.text)}.</p>
          <div className="row">
            <button disabled={version.text === text} onClick={() => onRestore(version.text, version.name)}>Go back to this</button>
            <button className="danger" onClick={() => change(versions.filter((other) => other !== version))}>Remove</button>
          </div>
        </div>
      ))}
    </section>
  );
}
