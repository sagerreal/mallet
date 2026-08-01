import type { LeadId, OrgId, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

/**
 * One entry in a customer's activity trail.
 *
 * The kinds mirror the store's LeadNote.type so the existing note feed renders these unchanged.
 * Text rather than an enum in the database — a new activity kind should not need a migration
 * before the app can start recording it — but validated here, because an unrecognised kind would
 * reach the feed as a bare word in a grey pill.
 */
export const LEAD_NOTE_KINDS = ["note", "call", "text", "system", "visit", "ai"] as const;
export type LeadNoteKind = (typeof LEAD_NOTE_KINDS)[number];

export const isLeadNoteKind = (value: string): value is LeadNoteKind =>
  (LEAD_NOTE_KINDS as readonly string[]).includes(value);

/** A note body cannot be longer than this. Matches the lead `notes` column's own ceiling. */
export const LEAD_NOTE_MAX = 2000;

export interface LeadNoteProps {
  readonly id: string;
  readonly orgId: OrgId;
  readonly leadId: LeadId;
  readonly kind: LeadNoteKind;
  readonly body: string;
  /** "us" | "them" | "auto" for a text; the staffer's name otherwise. Null when unattributed. */
  readonly author: string | null;
  readonly direction: string | null;
  readonly outcome: string | null;
  readonly durationLabel: string | null;
  readonly via: string | null;
  /** Front Desk overnight shift — feeds the home Handoff note. */
  readonly overnight: boolean;
  readonly createdAt: Date;
}

export class LeadNote {
  private constructor(private readonly p: LeadNoteProps) {}

  static create(props: LeadNoteProps): Result<LeadNote, ValidationError> {
    const body = props.body.trim();
    // A call logs an outcome with no typed body ("No answer"), and so does a system entry. Only
    // a hand-typed note is required to say something — an empty one is a slip, not a record.
    if (props.kind === "note" && body.length === 0) {
      return err(validation("a note needs some text", "body"));
    }
    if (body.length > LEAD_NOTE_MAX) {
      return err(validation(`a note cannot exceed ${LEAD_NOTE_MAX} characters`, "body"));
    }
    if (!isLeadNoteKind(props.kind)) {
      return err(validation(`unknown note kind "${props.kind}"`, "kind"));
    }
    return ok(new LeadNote({ ...props, body }));
  }

  get props(): LeadNoteProps {
    return this.p;
  }
}
