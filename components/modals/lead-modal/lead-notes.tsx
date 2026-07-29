/**
 * components/modals/lead-modal/lead-notes.tsx
 * NoteTimeline — faithful port of prototype noteTimeline(l) (lines ~6180-6195).
 * Gathers request note from l.job, internal from l.notes, all l.acts events.
 * Renders .card "Notes" + nfeed + cfrow composer.
 */

"use client";

import { useState } from "react";
import type { Lead } from "@/lib/store/types";
import { useAppStore } from "@/lib/store/app-store";
import { NoteRow, gatherNotes } from "./note-row";

interface LeadNotesProps {
  lead: Lead;
}

export function LeadNotes({ lead }: LeadNotesProps) {
  const addLeadNote = useAppStore((s) => s.addLeadNote);
  const [noteText, setNoteText] = useState("");

  function submitNote() {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    addLeadNote(lead.id, {
      type: "note",
      when: "Just now",
      notes: trimmed,
    });
    setNoteText("");
  }

  const entries = gatherNotes(lead);

  return (
    <div className="card">
      <h3>Notes</h3>

      {/* No "No notes yet — add the first below." line. The composer directly beneath
          it already says to add one, and on a phone that sentence plus its margin was
          pure height in a card that was already the tallest empty thing on screen. */}
      {entries.length > 0 && (
        <div className="nfeed" style={{ marginBottom: "var(--space-3)" }}>
          {entries.map((entry) => (
            <NoteRow key={entry.key} entry={entry} />
          ))}
        </div>
      )}

      {/* Composer — cfrow: input + Add note button */}
      <div className="cfrow">
        <input
          type="text"
          placeholder="gate code, what happened…"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitNote();
          }}
        />
        <button
          className="btn sm"
          onClick={submitNote}
          disabled={!noteText.trim()}
        >
          Add note
        </button>
      </div>
    </div>
  );
}
