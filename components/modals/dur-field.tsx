/**
 * components/modals/dur-field.tsx
 * Minute-precise "Length" field (h + m) for visit rows — extracted from
 * job-modal.tsx (prototype visitDurField) and rewritten around local drafts.
 *
 * Why drafts: the old field was fully controlled off the store float and
 * parsed + clamped EVERY keystroke — clearing the hours box snapped to 15
 * minutes and each keystroke fired the debounced persist, so typing fought
 * the store. Now:
 *   - typing only updates local string drafts ("" and partials allowed,
 *     no clamping mid-edit)
 *   - the value commits on blur (leaving the h+m group) and on Enter:
 *     parse, clamp (h 0–24, m 0–59, total 0.25–24 h), call onChange only
 *     when the value actually changed, resync drafts to the clamped values
 *   - prop/store updates resync the drafts only while the group is NOT
 *     focused, so a server reconcile can't stomp an in-progress edit
 */

"use client";

import { useEffect, useRef, useState } from "react";

// Commit clamps (mirror the backend: durationHours positive, max 24).
const MIN_TOTAL_HOURS = 0.25;
const MAX_TOTAL_HOURS = 24;
const MAX_HOURS = 24;
const MAX_MINUTES = 59;

export interface DurDrafts {
  h: string;
  m: string;
}

/** Split a fractional-hour duration into h/m input drafts ("2.5" → "2" + "30"). */
export function durToDrafts(dur: number): DurDrafts {
  const safe = Number.isFinite(dur) && dur > 0 ? dur : 0;
  let h = Math.floor(safe);
  let m = Math.round((safe - h) * 60);
  if (m === 60) {
    h += 1;
    m = 0;
  }
  return { h: String(h), m: String(m) };
}

/** Parse one draft to a whole number in [min, max]; "" / partials / garbage → min. */
function parseDraft(draft: string, min: number, max: number): number {
  const n = Math.round(Number(draft));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * Commit semantics for the h+m drafts: parse each (empty/invalid → 0), clamp
 * h to 0–24 and m to 0–59, clamp the total to 0.25–24 h, and return the
 * cleaned drafts alongside the committed fractional-hour duration.
 */
export function commitDrafts(hDraft: string, mDraft: string): DurDrafts & { dur: number } {
  const h = parseDraft(hDraft, 0, MAX_HOURS);
  const m = parseDraft(mDraft, 0, MAX_MINUTES);
  const dur = Math.min(MAX_TOTAL_HOURS, Math.max(MIN_TOTAL_HOURS, h + m / 60));
  return { ...durToDrafts(dur), dur };
}

export interface DurFieldProps {
  dur: number;
  onChange: (dur: number) => void;
}

/** Length as h + m (not a coarse 0.5h step) — mirrors visitDurField. */
export function DurField({ dur, onChange }: DurFieldProps) {
  const [drafts, setDrafts] = useState<DurDrafts>(() => durToDrafts(dur));
  // True while focus is inside the h+m group — blocks prop-driven resyncs.
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    setDrafts(durToDrafts(dur));
  }, [dur]);

  function commit() {
    const next = commitDrafts(drafts.h, drafts.m);
    setDrafts({ h: next.h, m: next.m });
    if (next.dur !== dur) onChange(next.dur);
  }

  function handleGroupFocus() {
    focusedRef.current = true;
  }

  function handleGroupBlur(e: React.FocusEvent<HTMLDivElement>) {
    // Moving between the h and m inputs stays inside the group — no commit.
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) return;
    focusedRef.current = false;
    commit();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    commit();
  }

  return (
    <div className="field" style={{ margin: "0" }}>
      <label>Length</label>
      <div
        className="sched-dur"
        style={{ flexWrap: "nowrap" }}
        onFocus={handleGroupFocus}
        onBlur={handleGroupBlur}
      >
        <input
          type="number"
          min={0}
          max={24}
          aria-label="Length hours"
          value={drafts.h}
          onChange={(e) => setDrafts({ ...drafts, h: e.target.value })}
          onKeyDown={handleKeyDown}
        />
        <span className="unit">h</span>
        <input
          type="number"
          min={0}
          max={59}
          step={5}
          aria-label="Length minutes"
          value={drafts.m}
          onChange={(e) => setDrafts({ ...drafts, m: e.target.value })}
          onKeyDown={handleKeyDown}
        />
        <span className="unit">m</span>
      </div>
    </div>
  );
}
