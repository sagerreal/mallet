/**
 * components/modals/tech-job-modal/note-feed.tsx
 * Notes feed (reuses the job-modal NoteFeed pattern, prototype jobNoteFeed) —
 * renders job.acts through the shared .nfeed chip rows.
 *
 * A COUNTED ROW ("Job notes  2 ›") that expands in flow. The count already existed in this file
 * and was never rendered, so the header said "Notes" whether the office had left three of them or
 * none, and the only way to find out was to scroll past the whole feed.
 */

"use client";

import { memo, useState } from "react";
import type { Job } from "@/lib/store/types";
import { AO_INPUT } from "./helpers";
import { SheetRow } from "@/components/modals/sheet-row";

interface NoteEntry {
  key: string;
  chipCls: string;
  label: string;
  who: string;
  when: string;
  text: string;
}

function jobNoteEntries(job: Job): NoteEntry[] {
  const E: NoteEntry[] = [];

  if ((job.notes ?? "").trim()) {
    E.push({
      key: "office",
      chipCls: "gray",
      label: "Office",
      who: "Office",
      when: "before the job",
      text: job.notes.trim(),
    });
  }

  // Job.acts is typed loosely (unknown[]); read the seeded note shape off a
  // narrow view and skip anything without text.
  const acts = (job.acts as Array<{ by?: string; who?: string; when?: string; t?: string }>) ?? [];
  acts.forEach((n, i) => {
    if (!(n.t ?? "").trim()) return;
    const isTech = n.by === "tech";
    E.push({
      key: `act-${i}`,
      chipCls: "blue",
      label: isTech ? "Field" : "Office",
      who: n.who ?? (isTech ? "Crew" : "Office"),
      when: n.when ?? "",
      text: (n.t ?? "").trim(),
    });
  });

  return E;
}

const NOTE_SAVE_FAILED_COPY = "Couldn't save the note — try again.";

export interface NoteFeedProps {
  job: Job;
  /**
   * Office-only + not-done gate for the composer: notes persist via
   * v1.jobs.update (ownerOrOffice — a tech write would FORBIDDEN + roll back)
   * and the server refuses edits on a complete job. Tech-writable notes
   * (v1.field.addNote + a real activity feed for job.acts) is a Phase-2
   * follow-up.
   */
  canCompose: boolean;
  /** Adds ONE note. Sends the text; the server stamps it and appends. */
  appendNote: (id: string, text: string) => Promise<{ ok: boolean }>;
}

// NoteFeed uses a custom comparator so a checklist tap (job.verify change)
// does NOT re-render it — it only reads job.notes, job.acts, and job.id.
export function noteFeedPropsEqual(a: NoteFeedProps, b: NoteFeedProps): boolean {
  return (
    a.canCompose === b.canCompose &&
    a.appendNote === b.appendNote &&
    a.job.id === b.job.id &&
    a.job.notes === b.job.notes &&
    a.job.acts === b.job.acts
  );
}

function NoteFeedFn({ job, canCompose, appendNote }: NoteFeedProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const entries = jobNoteEntries(job);

  /**
   * OPTIMISTIC, the house store pattern. appendJobNote's own optimistic set puts the note in the
   * feed in the same tick, so the input clears NOW — it used to clear on the mutation's
   * success, which left the same words sitting in the input AND the list for the whole round
   * trip. On a refusal the slice rolls the feed back and the text returns to the input (unless
   * the tech has already typed the next note — theirs wins), with the failure named in place.
   *
   * The cleared input is also the double-tap guard: a second Enter submits an empty string and
   * returns here. No `saving` state, no disabled button — there is nothing to wait for.
   */
  function addNote() {
    const t = text.trim();
    if (!t) return;
    // JUST THE TEXT. This used to read job.notes, append a stamped line in the browser and send
    // the WHOLE field back — so the office and the tech adding a note inside one round trip each
    // wrote their own version of it, and the second one landing erased the first. The server
    // appends to what the field holds now (AppendJobNoteUseCase); the stamp is its business.
    setText("");
    setError("");
    void appendNote(job.id, t).then(({ ok }) => {
      if (ok) return;
      setError(NOTE_SAVE_FAILED_COPY);
      setText((cur) => (cur ? cur : t));
    });
  }

  return (
    // The count was already computed and simply never shown — the header was a bare "Notes", so
    // the only way to learn whether the office had left anything was to read past it.
    <SheetRow variant="section" label="Job notes" value={entries.length} expandable>
      {entries.length > 0 ? (
        <div className="nfeed">
          {entries.map((n) => (
            <div className="nrow" key={n.key}>
              <div className="nmeta">
                <span className={`pill ${n.chipCls}`}>{n.label}</span>
                <span className="nwho">
                  {n.who ? `${n.who} · ` : ""}
                  {n.when || ""}
                </span>
              </div>
              <div className="ntext">{n.text}</div>
            </div>
          ))}
        </div>
      ) : !canCompose ? (
        // Zero entries and no composer — never a bare labeled header.
        <div className="muted" style={{ fontSize: "var(--type-base)" }}>
          No notes yet.
        </div>
      ) : null}
      {canCompose && (
        <>
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: entries.length > 0 ? 8 : 0 }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addNote();
              }}
              placeholder="add a note…"
              aria-label="Add a note"
              style={{ flex: 1, minWidth: 140, ...AO_INPUT }}
            />
            <button
              type="button"
              className="btn sm primary"
              aria-label="Add note"
              onClick={addNote}
            >
              Add
            </button>
          </div>
          {error && (
            <div style={{ color: "var(--red)", fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>{error}</div>
          )}
        </>
      )}
    </SheetRow>
  );
}
export const NoteFeed = memo(NoteFeedFn, noteFeedPropsEqual);
