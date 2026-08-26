"use client";

/**
 * features/customers/tag-add-row.tsx
 * The "+ Add a new tag…" control at the foot of the tag picker.
 *
 * Extracted from TagPicker for one substantive reason beyond size: the refusal message has to
 * render in BOTH states — under the open input (the add was refused) and under the closed button
 * (the cap was hit on a plain tick) — and inlining it meant two copies of the same block that
 * could drift apart.
 *
 * A refused add keeps the typed name in the box. The reason the server gives is the only thing
 * that makes the next attempt different from the last one, so clearing the field and closing the
 * row — which is what this used to do — threw away both the name and the explanation.
 */

import { useState } from "react";
import { MAX_TAG_LENGTH } from "@/modules/customers/domain/customer-tags";

export interface TagAddRowProps {
  /** Persist the label and apply it. Returns a message when it was refused, else null. */
  readonly onAdd: (label: string) => Promise<string | null>;
  /** A message raised by the picker itself (e.g. the tag cap), shown when the row is closed. */
  readonly message: string | null;
  /** Clear the picker-level message — a fresh interaction supersedes it. */
  readonly onClearMessage: () => void;
}

function Refusal({ text }: { text: string }) {
  return (
    <div
      role="alert"
      style={{ color: "var(--red-700)", fontSize: "var(--type-sm)", padding: "0 var(--space-3) var(--space-2)" }}
    >
      {text}
    </div>
  );
}

export function TagAddRow({ onAdd, message, onClearMessage }: TagAddRowProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  const commit = async () => {
    const name = draft.trim();
    if (!name) return;
    setRefusal(null);
    const problem = await onAdd(name);
    if (problem) {
      setRefusal(problem);
      return;
    }
    setDraft("");
    setAdding(false);
  };

  const cancel = () => {
    setAdding(false);
    setDraft("");
    setRefusal(null);
  };

  if (!adding) {
    return (
      <>
        <button
          type="button"
          className="qa-srcopt add"
          onClick={() => {
            onClearMessage();
            setAdding(true);
          }}
        >
          + Add a new tag…
        </button>
        {message ? <Refusal text={message} /> : null}
      </>
    );
  }

  return (
    <>
      <div className="cfrow" style={{ padding: "var(--space-2) var(--space-3)" }}>
        <input
          type="text"
          placeholder="Tag name"
          value={draft}
          maxLength={MAX_TAG_LENGTH}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            }
            if (e.key === "Escape") cancel();
          }}
        />
        <button type="button" className="btn sm primary" onClick={() => void commit()}>
          Add
        </button>
      </div>
      {refusal ? <Refusal text={refusal} /> : null}
    </>
  );
}
