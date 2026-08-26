"use client";

/**
 * components/shared/note-composer.tsx
 * The one note composer. Extracted from the customer sheet's Notes body so the job sheet
 * can use the same control rather than growing a second, subtly different one.
 *
 * It owns the input and nothing else — no store, no lead, no job. The caller says what
 * happens on submit and gets told whether it worked, which is what let the same component
 * serve a customer note (optimistic store action, resolves immediately) and a job note
 * (a real await on the server) without either surface knowing about the other.
 *
 * FAILURE PUTS THE TEXT BACK. The customer composer cleared the field and rolled the store
 * back silently, so a failed save looked exactly like a successful one and the sentence the
 * office typed was gone. The tech feed already restored the text and named the failure; this
 * makes that the behaviour everywhere.
 */

import { useState, useEffect, useRef } from "react";

export function NoteComposer({
  placeholder,
  buttonLabel = "Add note",
  ariaLabel = "Add a note",
  autoFocus,
  disabled,
  onSubmit,
}: {
  placeholder: string;
  buttonLabel?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  /** Renders the composer read-only with a reason in place of the input. */
  disabled?: string | false;
  /**
   * Save the note. Return false (or throw) and the text is put back in the field.
   * Sync callers may return void — a store action that resolves optimistically counts
   * as success, which is how the customer sheet keeps its instant feel.
   */
  onSubmit: (text: string) => void | boolean | Promise<void | boolean>;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // One tap + type: expanding the row focuses the composer, so logging a gate code
  // costs a single tap.
  useEffect(() => {
    if (autoFocus && !disabled) inputRef.current?.focus();
  }, [autoFocus, disabled]);

  async function submit() {
    const t = text.trim();
    if (!t || saving || disabled) return;
    setError(null);
    setText("");
    setSaving(true);
    try {
      const ok = await onSubmit(t);
      if (ok === false) {
        setText(t);
        setError("Couldn't save the note — try again.");
      }
    } catch {
      setText(t);
      setError("Couldn't save the note — try again.");
    } finally {
      setSaving(false);
    }
  }

  if (disabled) {
    return (
      <p className="muted" style={{ fontSize: "var(--type-sm)", margin: 0 }}>
        {disabled}
      </p>
    );
  }

  return (
    <>
      <div className="cfrow" style={{ marginTop: 0 }}>
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          aria-label={ariaLabel}
        />
        <button className="btn" onClick={() => void submit()} disabled={!text.trim() || saving}>
          {saving ? "Saving…" : buttonLabel}
        </button>
      </div>
      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>
          {error}
        </p>
      )}
    </>
  );
}
