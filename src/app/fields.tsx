import { useEffect, useRef, useState } from "react";

// Keeps what you're typing until you leave the field or press Enter, so a half-typed
// number doesn't jump the part around.
export function NumberField({ label, value, onCommit, step = 0.5 }: { label: string; value: number; onCommit(value: string): void; step?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label>
      {label}
      <input
        type="number"
        step={step}
        value={draft ?? value}
        onFocus={() => setDraft(String(value))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) onCommit(draft);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft !== null) onCommit(draft);
        }}
      />
    </label>
  );
}

// The same for text, where every keystroke would otherwise rebuild.
export function TextField({ label, value, onCommit, placeholder }: { label: string; value: string; onCommit(value: string): void; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label>
      {label}
      <input
        type="text"
        spellCheck={false}
        placeholder={placeholder}
        value={draft ?? value}
        onFocus={() => setDraft(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== value) onCommit(draft);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft !== null && draft !== value) onCommit(draft);
        }}
      />
    </label>
  );
}

// React's onChange fires for every step of a colour picker's drag, and each would rebuild
// the whole shell. The native change event only fires once the choice is made.
export function ColorField({ label, value, onCommit }: { label: string; value: string; onCommit(value: string): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    const input = ref.current!;
    const listener = () => commit.current(input.value);
    input.addEventListener("change", listener);
    return () => input.removeEventListener("change", listener);
  }, []);
  useEffect(() => {
    if (/^#[0-9a-f]{6}$/i.test(value)) ref.current!.value = value;
  }, [value]);
  return (
    <label className="color-field">
      {label}
      <input type="color" ref={ref} defaultValue="#000000" />
    </label>
  );
}
