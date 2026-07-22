/**
 * components/ui/disclosure-row.tsx
 * The definition-list disclosure row (the Front Desk "RuleRow" pattern, now
 * shared): a quiet label-over-value head that expands its editor in-flow below.
 * One row = one setting; the parent owns which row is open (usually one at a
 * time). Renders the prototype `.fdd` classes.
 *
 * When to use: staged/optional inputs in a form or settings surface — the
 * collapsed value IS the summary. When not to use: the 2-3 essential fields of
 * a form (keep those as open `.field`s) or a single action (use a button).
 */

"use client";

import type { ReactNode } from "react";

interface DisclosureRowProps {
  label: string;
  /** The collapsed summary — always the CURRENT value, never a hint. */
  value: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function DisclosureRow({ label, value, open, onToggle, children }: DisclosureRowProps) {
  return (
    <div className={open ? "fdd open" : "fdd"}>
      {/* type=button: these rows live inside forms — a bare <button> submits. */}
      <button type="button" className="fdd-head" onClick={onToggle} aria-expanded={open}>
        <span className="fdd-l">{label}</span>
        <span className="fdd-v">{value}</span>
      </button>
      {open && <div className="fdd-body">{children}</div>}
    </div>
  );
}
