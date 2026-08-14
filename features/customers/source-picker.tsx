"use client";

/**
 * features/customers/source-picker.tsx
 * Choosing where a customer came from — and correcting the list while you are there.
 *
 * ONE PICKER, BOTH MODALS. It was only ever on the NEW-customer modal, so a source could be set
 * once, at the moment you know least about the job, and never changed. On an existing customer the
 * source was a line of text in the header that rendered NOTHING when empty — so the commonest case
 * (somebody typed the customer in a hurry and skipped it) had no way back. The API has always
 * accepted the change (`v1.customers.update` takes `source`); there was simply no control.
 *
 * THE LIST IS EDITED HERE, not on a settings page. A list you can add to but can only correct
 * somewhere else is how "Refferal" survives for a year: the place you notice the typo and the place
 * you fix it were different screens, and only one of them is on the way to anywhere.
 *
 * Removing takes away the CHOICE, not the history — leads already tagged keep their tag, which is
 * why it asks nothing first. Built-in sources have no remove; they are always available.
 */

import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { DEFAULT_SOURCES, mergeSources } from "./merge-sources";

export interface SourcePickerProps {
  /** The current source, or "" when none is set. */
  readonly value: string;
  readonly onPick: (source: string) => void;
}

export function SourcePicker({ value, onPick }: SourcePickerProps) {
  const storeSources = useAppStore((s) => s.sources);
  const addSource = useAppStore((s) => s.addSource);
  const removeSource = useAppStore((s) => s.removeSource);
  const merged = mergeSources(DEFAULT_SOURCES, storeSources);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const commit = async () => {
    const name = draft.trim();
    if (!name) return;
    setAddError(null);
    const result = await addSource(name);
    // A refused add used to clear the box and close the row regardless, so the typed name simply
    // disappeared. The server's reason is the only thing that makes the next attempt different
    // from the last, so it stays on screen with the name still in the box.
    if (!result.ok && result.reason === "failed") {
      setAddError(result.message);
      return;
    }
    // A duplicate is not an error worth a message here — the source already exists, so selecting it
    // is what the person meant either way.
    if (result.ok || result.reason === "duplicate") onPick(name);
    setDraft("");
    setAdding(false);
  };

  return (
    <div className="qa-srclist">
      {merged.map((s) => {
        const own = storeSources.find((c) => c.label === s.label);
        return (
          <div key={s.label} className="qa-srcrow">
            <button
              type="button"
              className={`qa-srcopt${value === s.label ? " on" : ""}`}
              onClick={() => onPick(s.label)}
            >
              <span>{s.label}</span>
              {value === s.label ? <span className="qa-srcok">✓</span> : null}
            </button>
            {own ? (
              <button
                type="button"
                className="qa-srcdel"
                aria-label={`Remove ${s.label} from the source list`}
                onClick={() => {
                  removeSource(own.id);
                  if (value === s.label) onPick("");
                }}
              >
                ✕
              </button>
            ) : null}
          </div>
        );
      })}

      {adding ? (
        <>
          <div className="cfrow" style={{ padding: "var(--space-2) var(--space-3)" }}>
            <input
              type="text"
              placeholder="Source name"
              value={draft}
              maxLength={100}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commit();
                }
                if (e.key === "Escape") {
                  setAdding(false);
                  setDraft("");
                  setAddError(null);
                }
              }}
            />
            <button type="button" className="btn sm primary" onClick={() => void commit()}>
              Add
            </button>
          </div>
          {addError && (
            <div
              role="alert"
              style={{ color: "var(--red-700)", fontSize: "var(--type-sm)", padding: "0 var(--space-3) var(--space-2)" }}
            >
              {addError}
            </div>
          )}
        </>
      ) : (
        <button type="button" className="qa-srcopt add" onClick={() => setAdding(true)}>
          + Add a new source…
        </button>
      )}
    </div>
  );
}
