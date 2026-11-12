// The tutorial's card over the view: the step, what to do, what's still missing, and Next, which
// only opens once the design shows the step is done. It ends on a card that says it's complete.
import { TUTORIAL, type TutorialState } from "./tutorial.js";

interface TutorialPanelProps {
  state: TutorialState;
  step: number; // the step shown, which is never past the first one that isn't done
  finished: boolean;
  printedParts: number;
  onNext(): void;
  onBack(): void;
  onLeave(): void;
}

export function TutorialPanel({ state, step, finished, printedParts, onNext, onBack, onLeave }: TutorialPanelProps) {
  if (finished) {
    const parts = (state.config.components ?? []).length;
    return (
      <section className="tutorial done" role="dialog" aria-label="Tutorial complete">
        <div className="tutorial-tick" aria-hidden="true">✓</div>
        <h2>Tutorial complete</h2>
        <p>
          You've designed a synth: {parts} parts in {printedParts} printed pieces, with no problems, and the files to print it. It's an
          ordinary design now. Keep changing it, save it, or share its link.
        </p>
        <div className="tutorial-steps" aria-hidden="true">
          {TUTORIAL.map((s) => (
            <span key={s.title} className="tutorial-dot done" title={s.title} />
          ))}
        </div>
        <button className="primary" onClick={onLeave}>
          Done
        </button>
      </section>
    );
  }
  const current = TUTORIAL[step]!;
  const missing = current.missing(state);
  const done = missing.length === 0;
  return (
    <section className="tutorial" role="dialog" aria-label="Tutorial">
      <p className="tutorial-count">
        Step {step + 1} of {TUTORIAL.length}
      </p>
      <div className="tutorial-steps" aria-hidden="true">
        {TUTORIAL.map((s, i) => (
          <span key={s.title} className={`tutorial-dot${i < step || (i === step && done) ? " done" : i === step ? " current" : ""}`} title={s.title} />
        ))}
      </div>
      <h2>{current.title}</h2>
      <p>{current.body}</p>
      <p className={done ? "tutorial-status ok" : "tutorial-status"} role="status">
        {done ? "Done. On to the next step." : `Still to do: ${missing.join(", ")}.`}
      </p>
      <div className="row">
        <button onClick={onBack} disabled={step === 0}>
          Back
        </button>
        <button className="primary" onClick={onNext} disabled={!done}>
          {step === TUTORIAL.length - 1 ? "Finish" : "Next"}
        </button>
        <button className="quiet" onClick={onLeave}>
          Leave the tutorial
        </button>
      </div>
    </section>
  );
}
