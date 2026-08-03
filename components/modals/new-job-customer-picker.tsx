/**
 * components/modals/new-job-customer-picker.tsx
 * The New-job modal's Customer field: a search-or-add input over the live leads.
 *
 * Replaces the native <input list>/<datalist> picker. The system datalist popup
 * is OS chrome: on macOS it overlays the entire modal, it ignores every design
 * token, and it renders differently in every browser — the exact failure the
 * no-floating-UI rule exists to prevent. Matches render IN-FLOW under the input
 * (material-manager precedent), reusing this modal's own .njchklist/.njchk-row
 * vocabulary, capped at MAX_SUGGESTIONS rows and scrolling inside the modal's
 * flow (max-height + overflow), never overlaying anything.
 *
 * Keyboard (AddressInput parity): ArrowDown/ArrowUp move the highlight, Enter
 * commits the highlighted (or top) match instead of submitting the form
 * mid-pick, Escape closes the list WITHOUT closing the modal. Free-typed names
 * pass through untouched — this is "search or ADD", and the caller's matchLead
 * resolves the committed text by trimmed case-insensitive name.
 */

"use client";

import { useId, useState, type KeyboardEvent } from "react";
import type { Lead } from "@/lib/store/types";

const MAX_SUGGESTIONS = 8;

export interface CustomerPickerProps {
  value: string;
  /** Live (non-archived) leads to search over — the caller filters archived. */
  leads: Lead[];
  onChange: (value: string) => void;
  /** Fires on picking an existing lead — the caller prefills phone/address. */
  onPick: (lead: Lead) => void;
  /** Fires when focus leaves the input (the typed-exact-name fill path). */
  onBlur?: () => void;
  /** Forwarded by Field's clone so the label's htmlFor reaches the real input. */
  id?: string;
}

export function CustomerPicker({ value, leads, onChange, onPick, onBlur, id }: CustomerPickerProps) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const q = value.trim().toLowerCase();
  const matches = q
    ? leads.filter((l) => l.name.toLowerCase().includes(q)).slice(0, MAX_SUGGESTIONS)
    : [];
  const showList = open && matches.length > 0;

  function commit(lead: Lead) {
    onChange(lead.name);
    onPick(lead);
    setOpen(false);
    setActiveIdx(-1);
  }

  function closeList() {
    setOpen(false);
    setActiveIdx(-1);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!showList) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      // While picking, Enter chooses — it must not submit the whole form.
      e.preventDefault();
      const chosen = matches[activeIdx >= 0 ? activeIdx : 0];
      if (chosen) commit(chosen);
    } else if (e.key === "Escape") {
      // Close the LIST only — the Modal shell closes the whole sheet on a
      // document-level Escape, so this must not reach it.
      e.stopPropagation();
      closeList();
    }
  }

  return (
    <div>
      <input
        type="text"
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={showList ? listboxId : undefined}
        autoComplete="off"
        placeholder="search or add"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIdx(-1);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          closeList();
          onBlur?.();
        }}
      />
      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Matching customers"
          className="njchklist"
          style={{
            listStyle: "none",
            marginTop: "var(--space-2)",
            // ~5 rows tall, then the list scrolls inside the modal's flow.
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {matches.map((l, i) => (
            <li
              key={l.id}
              role="option"
              aria-selected={i === activeIdx}
              className={`njchk-row${i === activeIdx ? " sel" : ""}`}
              // mousedown (not click) so the input's blur can't close the list
              // before the pick lands — AddressInput precedent.
              onMouseDown={(e) => {
                e.preventDefault();
                commit(l);
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {l.name}
              </span>
              {l.phone && l.phone !== "—" && (
                <span className="muted" style={{ flexShrink: 0 }}>
                  {l.phone}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
