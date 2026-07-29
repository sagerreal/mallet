/**
 * components/modals/lead-modal/lead-notes.tsx
 * The Notes accordion body — feed + composer, no card chrome (the SheetRow above it
 * is the header). The collapsed row shows the LATEST NOTE, not a count: a plumber
 * standing at a gate needs "Gate code 4482" on the closed row, not "3".
 */

"use client";

import { useState, useEffect, useRef } from "react";
import type { Lead } from "@/lib/store/types";
import { useAppStore } from "@/lib/store/app-store";
import { NoteRow, gatherNotes } from "./note-row";

/** Trailing text for the collapsed Notes row: latest note, newest first. */
export function latestNoteSnippet(lead: Lead): string | null {
  const entries = gatherNotes(lead);
  if (entries.length === 0) return null;
  const latest = entries[entries.length - 1];
  const text = (latest?.text ?? "").replace(/\s+/g, " ").trim();
  return text.length > 34 ? `${text.slice(0, 33)}…` : text || null;
}

export function NotesBody({ lead, autoFocus }: { lead: Lead; autoFocus?: boolean }) {
  const addLeadNote = useAppStore((s) => s.addLeadNote);
  const [noteText, setNoteText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // One tap + type: expanding the row focuses the composer, so logging a gate code
  // costs a single tap over the old always-visible composer.
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const entries = gatherNotes(lead);

  function submitNote() {
    const t = noteText.trim();
    if (!t) return;
    addLeadNote(lead.id, { type: "note", when: "Just now", notes: t });
    setNoteText("");
  }

  return (
    <>
      {entries.length > 0 && (
        <div className="nfeed" style={{ marginBottom: "var(--space-3)" }}>
          {entries.map((entry) => (
            <NoteRow key={entry.key} entry={entry} />
          ))}
        </div>
      )}
      <div className="cfrow" style={{ marginTop: 0 }}>
        <input
          ref={inputRef}
          type="text"
          placeholder="gate code, what they want…"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitNote();
          }}
          aria-label="Add a note"
        />
        <button className="btn" onClick={submitNote} disabled={!noteText.trim()}>
          Add note
        </button>
      </div>
    </>
  );
}
