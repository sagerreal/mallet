"use client";

/**
 * components/modals/editable-sheet-title.tsx
 *
 * The sheet heading, which IS the name field.
 *
 * A record's name is a HEADING until you ask to change it — a permanently-mounted input at the top
 * of a sheet reads as a form to fill in rather than a record to look at. Clicking the heading turns
 * it into the input, blur commits, Escape abandons.
 *
 * Extracted from the customer sheet's header so the job sheet can use the same behaviour instead of
 * carrying its title twice: an h2 at the top and a "Job" row further down holding the same string,
 * which meant scrolling past the name to reach the row that edits it.
 *
 * `display` is separate from `value` because a record can be shown under a stand-in it does not
 * own: an untitled job's heading falls back to the customer's name, but the field being edited is
 * still the job's own empty title.
 */

import { useEffect, useRef, useState } from "react";

export interface EditableSheetTitleProps {
  /** The record's own name — what the input edits. May be empty. */
  readonly value: string;
  /** What the heading reads when not editing. Falls back to a stand-in for an unnamed record. */
  readonly display: string;
  /** Called with the trimmed name, only when it actually changed. The caller may refuse it. */
  readonly onCommit: (name: string) => void;
  /** Accessible name for the input, e.g. "Job name". */
  readonly label: string;
  readonly placeholder?: string;
}

export function EditableSheetTitle({
  value,
  display,
  onCommit,
  label,
  placeholder,
}: EditableSheetTitleProps) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  // Resync whenever the record's name changes AND whenever the edit ends. The second half matters:
  // a caller may refuse the commit (the customer sheet ignores a blank name), and without this the
  // input would sit empty over a record that still has its old name.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed !== value) onCommit(trimmed);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={ref}
        className="lead-name"
        value={draft}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <h2 className="lead-title">
      <button
        type="button"
        className="lead-title-edit"
        onClick={() => setEditing(true)}
        aria-label={`${display} — rename`}
      >
        {display}
      </button>
    </h2>
  );
}
