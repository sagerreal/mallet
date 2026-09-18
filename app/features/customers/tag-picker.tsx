"use client";

/**
 * features/customers/tag-picker.tsx
 * Choosing a customer's tags — and correcting the shop's tag list while you are there.
 *
 * ONE PICKER, BOTH MODALS (new customer and existing). This replaced a single-select "Lead source"
 * row, and the reason it had to become a set is visible in the live book: the same customer is
 * found on Nextdoor AND is a repeat customer, so one slot forced a choice and lost whichever fact
 * came second. A single value also invited the wrong content — 162 of the 183 populated `source`
 * values were machine-written provenance ("Added manually", "Import"), because the only field that
 * looked like a label was already taken. Provenance now stays in `leads.source`, unedited by any
 * screen, and this picker owns the labels the office actually chooses.
 *
 * THE LIST IS EDITED HERE, not on a settings page. A list you can add to but can only correct
 * somewhere else is how "Refferal" survives for a year: the place you notice the typo and the
 * place you fix it were different screens, and only one of them was on the way to anywhere.
 *
 * A TAG THE CUSTOMER CARRIES ALWAYS APPEARS, even after the label leaves the shop's list. The
 * vocabulary and the stored set are separate things (removing a label takes away the CHOICE, not
 * the history), so rendering only the vocabulary would hide a tag that is really there — and
 * because onChange posts the FULL set, the next click on any other row would write the set
 * without it. The rows are the UNION, so what you see is what is stored.
 */

import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
// The shop's tag vocabulary. Still named "sources" in the store, the tRPC path and the
// `lead_sources` table: those names are load-bearing (a shared dev/prod DB makes a table rename
// non-additive) and a half-rename reads worse than a documented stable one. See the note on the
// lead_sources schema — the concept is tags.
import { DEFAULT_SOURCES, mergeSources } from "./merge-sources";
import { MAX_TAGS } from "@/modules/customers/domain/customer-tags";
import { TagAddRow } from "./tag-add-row";

export interface TagPickerProps {
  /** The customer's current tags. Empty when untagged. */
  readonly value: readonly string[];
  /** Receives the FULL replacement set — this is how an untick removes a tag. */
  readonly onChange: (tags: readonly string[]) => void;
}

const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function TagPicker({ value, onChange }: TagPickerProps) {
  // Defaulted: the picker is no longer behind a chevron, so it mounts whenever Contact is open.
  // A store without this slice yet would throw inside mergeSources and take the whole
  // customer sheet down with it, rather than losing one row.
  const storeSources = useAppStore((s) => s.sources) ?? [];
  const addSource = useAppStore((s) => s.addSource);
  const removeSource = useAppStore((s) => s.removeSource);
  const [message, setMessage] = useState<string | null>(null);

  const vocabulary = mergeSources(DEFAULT_SOURCES, storeSources).map((s) => s.label);
  // Tags this customer carries that are no longer offered — kept visible (see the header note).
  const orphans = value.filter((t) => !vocabulary.some((label) => sameTag(label, t)));
  const rows = [...vocabulary, ...orphans];

  const isOn = (label: string) => value.some((t) => sameTag(t, label));
  const without = (label: string) => value.filter((t) => !sameTag(t, label));

  /**
   * Apply one tag, or say why it will not apply. The cap is a domain invariant, so a click that
   * silently did nothing would look like a dead button and then fail the save with no explanation
   * of which click caused it.
   */
  const apply = (label: string): string | null => {
    if (value.length >= MAX_TAGS) return `A customer can carry at most ${MAX_TAGS} tags.`;
    onChange([...value, label]);
    return null;
  };

  const toggle = (label: string) => {
    if (isOn(label)) {
      setMessage(null);
      onChange(without(label));
      return;
    }
    setMessage(apply(label));
  };

  /** Persist a brand-new label and apply it. Returns a refusal message, or null on success. */
  const addAndApply = async (name: string): Promise<string | null> => {
    const result = await addSource(name);
    // A refusal the server explained is the only thing that makes the next attempt different.
    if (!result.ok && result.reason === "failed") return result.message;
    // A duplicate is not an error worth a message: the tag already exists, so applying it is what
    // the person meant either way. Already-applied is a no-op rather than a second copy.
    if (isOn(name)) return null;
    return apply(name);
  };

  return (
    <div className="qa-srclist">
      {rows.map((label) => {
        const own = storeSources.find((c) => c.label === label);
        const on = isOn(label);
        return (
          <div key={label} className="qa-srcrow">
            <button
              type="button"
              className={`qa-srcopt${on ? " on" : ""}`}
              aria-pressed={on}
              onClick={() => toggle(label)}
            >
              <span>{label}</span>
              {on ? <span className="qa-srcok">✓</span> : null}
            </button>
            {own ? (
              <button
                type="button"
                className="qa-srcdel"
                aria-label={`Remove ${label} from the tag list`}
                onClick={() => {
                  removeSource(own.id);
                  // Untick it here too: a ticked row that no longer exists shows a selection with
                  // nothing behind it. Other customers keep the tag.
                  if (on) onChange(without(label));
                }}
              >
                ✕
              </button>
            ) : null}
          </div>
        );
      })}

      <TagAddRow onAdd={addAndApply} message={message} onClearMessage={() => setMessage(null)} />
    </div>
  );
}
