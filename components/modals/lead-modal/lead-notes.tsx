/**
 * components/modals/lead-modal/lead-notes.tsx
 * The Notes accordion body — feed + composer, no card chrome (the SheetRow above it
 * is the header). The collapsed row shows the LATEST NOTE, not a count: a plumber
 * standing at a gate needs "Gate code 4482" on the closed row, not "3".
 */

"use client";

import type { Lead } from "@/lib/store/types";
import { useAppStore } from "@/lib/store/app-store";
import { NoteComposer } from "@/components/shared/note-composer";
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
  const entries = gatherNotes(lead);

  return (
    <>
      {entries.length > 0 && (
        <div className="nfeed" style={{ marginBottom: "var(--space-3)" }}>
          {entries.map((entry) => (
            <NoteRow key={entry.key} entry={entry} />
          ))}
        </div>
      )}
      <NoteComposer
        placeholder="gate code, what they want…"
        autoFocus={autoFocus}
        onSubmit={(text) => {
          // Optimistic by design: the store returns the note synchronously (the home queue's
          // Undo needs its id before the server answers), so this reads as success here and a
          // genuine failure surfaces through the store's own rollback.
          addLeadNote(lead.id, { type: "note", when: "Just now", notes: text });
        }}
      />
    </>
  );

}
