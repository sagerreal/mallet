/**
 * components/modals/tech-job-modal/counted-section.tsx
 * A field-sheet section that reads as a navigation row until you want it: label left, count and
 * a chevron right, body expanding IN FLOW beneath — never a popover, never a new screen.
 *
 *   Found work                    0 ›
 *   Job notes                     2 ›
 *
 * The count is the point. Found work and Notes are the two sections a technician needs to KNOW
 * ABOUT more often than read, and both were previously always-expanded blocks that pushed the
 * work order and the foot primary off the bottom of a phone. A number answers "is there anything
 * in there" without costing any height.
 *
 * Reuses the `.tjf` collapsible vocabulary already in app/prototype.css ("collapsible field-job
 * sections (tech view) — default to titles, tap to expand"), which was written for this and had
 * no callers.
 */

"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

/** The count/chevron cluster: not uppercase, not tracked-out — a figure, not a label. */
const COUNT: CSSProperties = {
  textTransform: "none",
  letterSpacing: 0,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-2)",
};

interface CountedSectionProps {
  label: string;
  count: number;
  /** A short qualifier beside the count ("2 awaiting OK"). Omitted when there is nothing to add. */
  hint?: string;
  /** Expanded on first render — for a section whose contents are the reason you opened the sheet. */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CountedSection({ label, count, hint, defaultOpen = false, children }: CountedSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={open ? "fsec tjf open" : "fsec tjf"}>
      <button
        type="button"
        className="fsec-h tjf-h"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tjf-t">{label}</span>
        <span style={COUNT}>
          {hint ? `${count} · ${hint}` : count}
          <span className="tjcaret" aria-hidden="true">
            ›
          </span>
        </span>
      </button>
      {open ? children : null}
    </div>
  );
}
