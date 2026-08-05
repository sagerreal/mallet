/**
 * components/modals/tech-job-modal/visit-stepper.tsx
 * Scheduled → On the way → On site, as a READOUT. See visit-steps.ts for why it is not a control
 * and why a skipped step stays visibly skipped.
 *
 * MARKUP IS A LIST, NOT A TABLIST. A stepper is a set of states with one current — an ordered
 * list with `aria-current="step"` on the one the visit is at, which is the pattern
 * `aria-current` exists for. It is emphatically NOT a tablist (nothing here selects a panel), and
 * this file's own modal has already been bitten once by a tablist with no tabpanels.
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

const TIME_STYLE: CSSProperties = {
  display: "block",
  marginTop: "var(--space-2xs)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--type-xs)",
  color: "var(--ink-3)",
};

export function VisitStepper({ visit }: { visit: Visit }) {
  const steps = visitSteps(visit);

  return (
    <ol className="vstep" aria-label="Visit progress">
      {steps.map((s) => (
        <li
          key={s.key}
          className={`vstep-n ${s.state}`}
          aria-current={s.state === "current" ? "step" : undefined}
        >
          <span className="vstep-dot" aria-hidden="true" />
          <span className="vstep-lab">{s.label}</span>
          <span className="sr-only">, {SPOKEN[s.state]}</span>
          {s.time ? (
            <span style={TIME_STYLE}>{s.time}</span>
          ) : s.state === "skipped" ? (
            <span style={TIME_STYLE} aria-hidden="true">
              skipped
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
