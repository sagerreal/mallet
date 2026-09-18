/**
 * components/modals/lead-modal/note-row.tsx
 * Single note row: .nrow → .nmeta (chip + nwho) + .ntext
 * Mirrors prototype noteChipCls + NOTE_LABEL map.
 */

"use client";

import { useState } from "react";
import type { LeadNote } from "@/lib/store/types";
import { trpcVanilla } from "@/lib/trpc/vanilla";

// Note type labels — mirrors prototype NOTE_LABEL
export const NOTE_LABEL: Record<string, string> = {
  request: "Request",
  internal: "Internal",
  scope: "Scope",
  change: "Change order",
  prep: "Bring to the job",
  completion: "Completed",
  call: "Call",
  text: "Text",
  visit: "Visit",
  ai: "AI",
  note: "Note",
  system: "System",
};

// Maps note type to pill color class — mirrors prototype noteChipCls
export function noteChipCls(type: string): string {
  if (type === "completion") return "green";
  if (type === "change") return "amber";
  if (
    type === "call" ||
    type === "text" ||
    type === "visit" ||
    type === "ai" ||
    type === "field"
  )
    return "blue";
  return "gray";
}

/**
 * The one file a note carries, in the only form this row needs: what to call it, and the two
 * ids the server wants to mint a link. Never a URL and never a storage path — the bucket is
 * private, the path lives on the row, and the server signs from the row it looks up. A path
 * passed through the client here would be a path the client could change.
 */
export interface NoteAttachmentRef {
  /** The customer the note hangs off — half of the lookup key. */
  leadId: string;
  /** The lead_notes row id. Absent-ids never get here: an unsaved note has nothing to open. */
  noteId: string;
  /** The name a person recognises — the button's label. */
  name: string;
  /** Canonical mime, kept for the badge and for anything that later wants to preview inline. */
  type: string;
}

export interface NoteEntry {
  /** Unique key for React rendering */
  key: string;
  /** Note type for label/chip */
  type: string;
  /** Display label — overrides NOTE_LABEL lookup if set */
  label?: string;
  /** Who added / direction hint */
  who: string;
  /** When string */
  when: string;
  /** Body text */
  text: string;
  /** The file or photo on this note, if it has one. Absent is the common case. */
  attachment?: NoteAttachmentRef;
}

interface NoteChipProps {
  type: string;
  label?: string;
}

export function NoteChip({ type, label }: NoteChipProps) {
  const cls = noteChipCls(type);
  const display = label ?? NOTE_LABEL[type] ?? type;
  return <span className={`pill ${cls}`}>{display}</span>;
}

/**
 * The attachment line under a note's text.
 *
 * OPENING IS A ROUND TRIP. The bucket is private, so there is no durable link to render up
 * front — the name is exchanged for a short-lived signed URL at click time, minted from the
 * path STORED on the row. Minting one for every note on open would hand out URLs nobody asked
 * for, and for a feed that can run to dozens of entries that is dozens of pointless signatures.
 *
 * The window is opened BEFORE the await and pointed afterwards: a popup blocker only trusts a
 * window created inside the click, and a tab opened after a network round trip is blocked.
 * Same shape as job-files.tsx openFile().
 */
function NoteAttachment({ att }: { att: NoteAttachmentRef }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (opening) return;
    setError(null);
    setOpening(true);
    const tab = window.open("", "_blank", "noopener,noreferrer");
    try {
      const { url } = await trpcVanilla.v1.customers.noteViewUrl.mutate({
        leadId: att.leadId,
        id: att.noteId,
      });
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch {
      tab?.close();
      setError("That file wouldn't open — try again.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div style={{ marginTop: "var(--space-1)" }}>
      <button
        type="button"
        className="linklike"
        style={{
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "left",
        }}
        onClick={() => void open()}
        aria-busy={opening ? true : undefined}
      >
        {opening ? "Opening…" : att.name}
      </button>
      {error && (
        <p
          role="alert"
          style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-1) 0 0" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

interface NoteRowProps {
  entry: NoteEntry;
}

export function NoteRow({ entry }: NoteRowProps) {
  return (
    <div className="nrow">
      <div className="nmeta">
        <NoteChip type={entry.type} label={entry.label} />
        <span className="nwho">
          {entry.who}
          {entry.when ? ` · ${entry.when}` : ""}
        </span>
      </div>
      {entry.text && <div className="ntext">{entry.text}</div>}
      {entry.attachment && <NoteAttachment att={entry.attachment} />}
    </div>
  );
}

/**
 * gatherNotes — converts a lead's data into sorted NoteEntry[].
 * Mirrors prototype gatherNotes(l):
 *   - l.job → type "request" note
 *   - l.notes → type "internal" note
 *   - l.acts[] → mapped by type
 *
 * The attachment rides through here untouched, which is the whole reason the JOB modal shows
 * a customer's attachment without knowing attachments exist: it renders this feed.
 */
export function gatherNotes(lead: {
  id: string;
  name: string;
  job?: string;
  notes?: string;
  acts?: LeadNote[];
}): NoteEntry[] {
  const entries: NoteEntry[] = [];

  // 1. Request note from l.job
  if (lead.job) {
    entries.push({
      key: `req-${lead.id}`,
      type: "request",
      who: lead.name,
      when: "",
      text: lead.job,
    });
  }

  // 2. Internal note from l.notes
  if (lead.notes) {
    entries.push({
      key: `int-${lead.id}`,
      type: "internal",
      who: "Office",
      when: "",
      text: lead.notes,
    });
  }

  // 3. Acts
  const acts = lead.acts ?? [];
  acts.forEach((act, i) => {
    let who = "";
    let label: string | undefined = undefined;
    let text = act.t ?? act.notes ?? "";

    if (act.type === "call") {
      const dir = act.dir === "in" ? "Inbound" : "Outbound";
      const outcome = act.outcome ? ` — ${act.outcome}` : "";
      const dur = act.dur ? ` (${act.dur})` : "";
      label = `${dir} call${outcome}${dur}`;
      who = act.via ? `via ${act.via}` : "";
    } else if (act.type === "text") {
      if (act.from === "us") {
        label = "You";
        who = "";
      } else if (act.from === "auto") {
        label = "Auto";
        who = "";
      } else {
        label = "Them";
        who = "";
      }
    } else if (act.type === "visit") {
      label = "Visit";
      who = "";
    } else if (act.type === "ai") {
      label = "AI";
      who = "";
    }

    entries.push({
      key: `act-${lead.id}-${i}`,
      type: act.type,
      label,
      who,
      when: act.when,
      text,
      // An id is required, not incidental: the signed URL is minted by (org, lead, note id), so
      // a note still in flight has nothing to look up and simply shows its text until it lands.
      ...(act.att && act.id
        ? { attachment: { leadId: lead.id, noteId: act.id, name: act.att.name, type: act.att.type } }
        : {}),
    });
  });

  return entries;
}
