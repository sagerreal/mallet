/**
 * components/modals/lead-modal/note-row.tsx
 * Single note row: .nrow → .nmeta (chip + nwho) + .ntext
 * Mirrors prototype noteChipCls + NOTE_LABEL map.
 */

"use client";

import type { LeadNote } from "@/lib/store/types";

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
    </div>
  );
}

/**
 * gatherNotes — converts a lead's data into sorted NoteEntry[].
 * Mirrors prototype gatherNotes(l):
 *   - l.job → type "request" note
 *   - l.notes → type "internal" note
 *   - l.acts[] → mapped by type
 */
export function gatherNotes(lead: {
  id: number;
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
    });
  });

  return entries;
}
