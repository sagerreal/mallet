/**
 * components/modals/lead-modal/lead-notes.tsx
 * The Notes accordion body — feed + composer, no card chrome (the SheetRow above it
 * is the header). The collapsed row shows the LATEST NOTE, not a count: a plumber
 * standing at a gate needs "Gate code 4482" on the closed row, not "3".
 */

"use client";

import { useRef } from "react";
import type { Lead } from "@/lib/store/types";
import { useAppStore } from "@/lib/store/app-store";
import { NoteComposer } from "@/components/shared/note-composer";
import {
  uploadLeadNoteFile,
  NOTE_ATTACH_ACCEPT,
  type UploadedNoteAttachment,
} from "@/lib/store/upload-lead-note-file";
import { UnsupportedFileError, FileTooLargeError } from "@/lib/store/upload-job-file";
import { NoteRow, gatherNotes } from "./note-row";

/**
 * Trailing text for the collapsed Notes row: latest note, newest first.
 *
 * A note that is only a photo has no sentence, so the FILENAME stands in — blanking the row
 * because the newest entry was a picture would hide the fact that anything was added at all.
 */
export function latestNoteSnippet(lead: Lead): string | null {
  const entries = gatherNotes(lead);
  if (entries.length === 0) return null;
  const latest = entries[entries.length - 1];
  const body = (latest?.text ?? "").replace(/\s+/g, " ").trim();
  const text = body || latest?.attachment?.name || "";
  return text.length > 34 ? `${text.slice(0, 33)}…` : text || null;
}

/** Turn an upload failure into a line that names the rule the file broke. */
function attachErrorMessage(err: unknown): string {
  if (err instanceof UnsupportedFileError) return `Can't attach a .${err.ext} file.`;
  if (err instanceof FileTooLargeError) return "That file is over 10 MB.";
  return "That didn't upload — try again.";
}

export function NotesBody({ lead, autoFocus }: { lead: Lead; autoFocus?: boolean }) {
  const addLeadNote = useAppStore((s) => s.addLeadNote);
  const entries = gatherNotes(lead);

  /**
   * The file already in storage, waiting for the note that will point at it.
   *
   * A ref, not state: nothing on this screen re-renders because of it (the composer shows the
   * filename off its own state), and a re-render mid-typing must not drop it. If the sheet is
   * closed before the note is added, the bytes are simply orphaned in the bucket — no row ever
   * referenced them, which is the right failure: a half-written note is worse than a stray file.
   */
  const pendingAtt = useRef<UploadedNoteAttachment | null>(null);

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
        attachAccept={NOTE_ATTACH_ACCEPT}
        onAttachFile={async (file) => {
          try {
            pendingAtt.current = await uploadLeadNoteFile(lead.id, file);
          } catch (err: unknown) {
            // The composer prints this message verbatim, so it has to be the real reason.
            throw new Error(attachErrorMessage(err));
          }
        }}
        onSubmit={(text) => {
          // Optimistic by design: the store returns the note synchronously (the home queue's
          // Undo needs its id before the server answers), so this reads as success here and a
          // genuine failure surfaces through the store's own rollback.
          const att = pendingAtt.current;
          addLeadNote(lead.id, {
            type: "note",
            when: "Just now",
            // Empty when the note is only a file. Omitted rather than sent as "" so the
            // collapsed row keeps the last sentence anyone actually wrote.
            ...(text ? { notes: text } : {}),
            ...(att ? { att } : {}),
          });
          pendingAtt.current = null;
        }}
      />
    </>
  );
}
