/**
 * components/modals/tech-job-modal/visit-stepper.tsx
 * Scheduled → On the way → On site. A readout of what was recorded, and — for the viewer whose
 * visit this is — a way to jump FORWARD to a step that has not happened yet. See visit-steps.ts
 * for why only the nodes ahead of the cursor are live and why a skipped step stays visibly
 * skipped.
 *
 * MARKUP IS A LIST, NOT A TABLIST. A stepper is a set of states with one current — an ordered
 * list with `aria-current="step"` on the one the visit is at, which is the pattern
 * `aria-current` exists for. It is emphatically NOT a tablist (nothing here selects a panel), and
 * this file's own modal has already been bitten once by a tablist with no tabpanels.
 *
 * EVERY NODE RENDERS THE SAME BOX (`.vstep-body`) — a `<button>` when it is a live jump, a
 * `<span>` when it is not — so the three thirds keep identical geometry whether or not this
 * viewer may move the visit, and the live ones get the 44px target the readout-only argument in
 * visit-steps.ts was right to insist on.
 *
 * The dots are decorative: every node's state is carried by its words — the label plus either a
 * time or the word "skipped" — so nothing depends on seeing the fill.
 */

"use client";

import type { CSSProperties } from "react";
import type { Visit } from "@/lib/store/types";
import { visitSteps, type VisitStepState } from "./visit-steps";

/** The screen-reader sentence for a node. The dot says this visually; this says it out loud. */
const SPOKEN: Record<VisitStepState, string> = {
  reached: "done",
  current: "current step",
  skipped: "skipped — nobody recorded this",
  pending: "not yet",
};

/** What a live node says instead: the state, then what tapping it does. */
const SPOKEN_JUMP = "not yet — tap to move the visit here";

const TIME_STYLE: CSSProperties = {
  display: "block",
  marginTop: "var(--space-2xs)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--type-xs)",
  color: "var(--ink-3)",
};

interface VisitStepperProps {
  visit: Visit;
  /**
   * The list's accessible name. A two-visit sheet renders two of these, and both announcing
   * "Visit progress" leaves a screen-reader user with the same "which one is this?" the visible
   * caption fixes for everyone else. Defaults to the unnumbered name for a lone stepper.
   */
  label?: string;
  /**
   * Move the visit forward to `status`. Omitted when this viewer may not move this visit — a
   * technician looking at a colleague's stop, or a finished visit, where the only way back is the
   * office's ↩ Reopen. Without it every node is inert, which is what this component always was.
   */
  onJump?: (status: string) => void;
}

export function VisitStepper({ visit, label, onJump }: VisitStepperProps) {
  const steps = visitSteps(visit);

  return (
    <ol className="vstep" aria-label={label ?? "Visit progress"}>
      {steps.map((s) => {
        const jumpTo = onJump && s.jumpTo ? s.jumpTo : null;
        const body = (
          <>
            <span className="vstep-dot" aria-hidden="true" />
            <span className="vstep-lab">{s.label}</span>
            <span className="sr-only">, {jumpTo ? SPOKEN_JUMP : SPOKEN[s.state]}</span>
            {/* The second line, and the one place an affordance can live without moving anything.
                A reached step prints its stamp here, a skipped one prints "skipped", and a pending
                one printed nothing at all — which is why a tappable node was indistinguishable
                from a dead readout: the ONLY rule separating them dimmed a label a shade.
                A word in the same mono/xs/muted style as the stamp says what the tap does, costs
                no geometry, keeps the row a record rather than a button strip, and — unlike a
                colour or a border — survives daylight, gloves and a colour-blind technician. */}
            {s.time ? (
              <span style={TIME_STYLE}>{s.time}</span>
            ) : s.state === "skipped" ? (
              <span style={TIME_STYLE} aria-hidden="true">
                skipped
              </span>
            ) : jumpTo ? (
              <span style={TIME_STYLE} aria-hidden="true">
                tap to record
              </span>
            ) : null}
          </>
        );

        return (
          <li
            key={s.key}
            className={`vstep-n ${s.state}${jumpTo ? " jumpable" : ""}`}
            aria-current={s.state === "current" ? "step" : undefined}
          >
            {jumpTo ? (
              <button type="button" className="vstep-body" onClick={() => onJump?.(jumpTo)}>
                {body}
              </button>
            ) : (
              <span className="vstep-body">{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
