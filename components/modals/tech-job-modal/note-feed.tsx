/**
 * components/modals/tech-job-modal/note-feed.tsx
 * Notes feed (reuses the job-modal NoteFeed pattern, prototype jobNoteFeed) —
 * renders job.acts through the shared .nfeed chip rows. Renders nothing when
 * there's nothing to show. bare — no card wrapper (the .fsec carries the label).
 */

"use client";

import { memo, useState } from "react";
import type { Job } from "@/lib/store/types";
import { todayISO } from "@/lib/clock";
import { AO_INPUT } from "./helpers";

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
  updateJob: (id: string, patch: Partial<Job>) => Promise<{ ok: boolean }>;
}

// NoteFeed uses a custom comparator so a checklist tap (job.verify change)
// does NOT re-render it — it only reads job.notes, job.acts, and job.id.
export function noteFeedPropsEqual(a: NoteFeedProps, b: NoteFeedProps): boolean {
  return (
    a.canCompose === b.canCompose &&
    a.updateJob === b.updateJob &&
    a.job.id === b.job.id &&
    a.job.notes === b.job.notes &&
    a.job.acts === b.job.acts
  );
}

function NoteFeedFn({ job, canCompose, updateJob }: NoteFeedProps) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const entries = jobNoteEntries(job);

  async function addNote() {
    const t = text.trim();
    if (!t || saving) return;
    // Append one stamped line ("[Jul 13] …") to the job's notes blob; the
    // feed's .ntext renders white-space:pre-line so each line reads separately.
    const stamp = new Date(todayISO() + "T12:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const existing = (job.notes ?? "").trim();
    const next = existing ? `${existing}\n[${stamp}] ${t}` : `[${stamp}] ${t}`;
    setSaving(true);
    setError("");
    const { ok } = await updateJob(job.id, { notes: next });
    setSaving(false);
    if (!ok) {
      setError(NOTE_SAVE_FAILED_COPY);
      return;
    }
    setText("");
  }

  return (
    <div className="fsec">
      <div className="fsec-h">
        <span>Notes</span>
      </div>
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
                if (e.key === "Enter") void addNote();
              }}
              placeholder="add a note…"
              aria-label="Add a note"
              style={{ flex: 1, minWidth: 140, ...AO_INPUT }}
            />
            <button
              className="btn sm primary"
              aria-label="Add note"
              disabled={saving}
              onClick={() => void addNote()}
            >
              Add
            </button>
          </div>
          {error && (
            <div style={{ color: "var(--red)", fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>{error}</div>
          )}
        </>
      )}
    </div>
  );
}
export const NoteFeed = memo(NoteFeedFn, noteFeedPropsEqual);
