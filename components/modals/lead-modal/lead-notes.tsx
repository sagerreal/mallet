/**
 * components/modals/lead-modal/lead-notes.tsx
 * Notes timeline + add-note input.
 * Mirrors prototype noteFeedInner() — shows act[] chronologically.
 */

"use client";

import { useState } from "react";
import type { Lead, LeadNote } from "@/lib/store/types";
import { useAppStore } from "@/lib/store/app-store";

interface LeadNotesProps {
  lead: Lead;
}

function NoteRow({ note }: { note: LeadNote }) {
  const label =
    note.type === "call"
      ? `📞 ${note.dir === "in" ? "Inbound" : "Outbound"} call — ${note.outcome ?? ""} ${note.dur ? `(${note.dur})` : ""}`
      : note.type === "text"
      ? note.from === "us"
        ? "You →"
        : note.from === "auto"
        ? "Auto →"
        : "← They"
      : "Note";

  return (
    <div style={{ borderLeft: "2px solid var(--line-2)", paddingLeft: 12, marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 2 }}>
        {label} · {note.when}
      </div>
      <div style={{ fontSize: 13.5 }}>{note.t ?? note.notes ?? ""}</div>
    </div>
  );
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

  const acts = lead.acts ?? [];

  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "var(--ink-2)" }}>
        Timeline
      </h3>

      {acts.length === 0 && (
        <p className="muted" style={{ fontSize: 13 }}>No activity yet.</p>
      )}

      {acts.map((note, i) => (
        <NoteRow key={note.id ?? i} note={note} />
      ))}

      {/* Add note */}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          type="text"
          placeholder="Add a note…"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submitNote(); }}
          style={{ flex: 1 }}
        />
        <button
          className="btn sm"
          onClick={submitNote}
          disabled={!noteText.trim()}
        >
          Add
        </button>
      </div>
    </div>
  );
}
