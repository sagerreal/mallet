import type {
  LeadId,
  OrgId,
  Result,
  ValidationError,
} from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

/**
 * One entry in a customer's activity trail.
 *
 * The kinds mirror the store's LeadNote.type so the existing note feed renders these unchanged.
 * Text rather than an enum in the database — a new activity kind should not need a migration
 * before the app can start recording it — but validated here, because an unrecognised kind would
 * reach the feed as a bare word in a grey pill.
 */
export const LEAD_NOTE_KINDS = [
  "note",
  "call",
  "text",
  "system",
  "visit",
  "ai",
] as const;
export type LeadNoteKind = (typeof LEAD_NOTE_KINDS)[number];

export const isLeadNoteKind = (value: string): value is LeadNoteKind =>
  (LEAD_NOTE_KINDS as readonly string[]).includes(value);

/** A note body cannot be longer than this. Matches the lead `notes` column's own ceiling. */
export const LEAD_NOTE_MAX = 2000;

/** A filename is a label on a button, not a paragraph. */
export const LEAD_NOTE_ATTACHMENT_NAME_MAX = 200;

/**
 * Where a customer note's attachment is allowed to live: the customer's own folder inside the
 * private job-photos bucket. The prefix is built from the org and lead the note itself belongs
 * to, so a path is checked against the row being written rather than against anything a caller
 * asserted separately — the only way to point a note at another tenant's object is to fail this.
 */
export const leadNoteAttachmentPrefix = (
  orgId: OrgId,
  leadId: LeadId,
): string => `${orgId}/leads/${leadId}/`;

/** The attachment as the domain holds it: present in full, or not at all. */
export interface LeadNoteAttachment {
  readonly path: string;
  readonly type: string;
  readonly name: string;
}

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
  /**
   * ONE attachment — a document or a photo. The three fields move together: all set, or all
   * null, matching the lead_notes_attachment_shape_check the storage layer enforces. Optional
   * on the way in so every existing caller that never attaches anything compiles unchanged;
   * always resolved to an explicit null on the way out.
   */
  readonly attachmentPath?: string | null;
  readonly attachmentType?: string | null;
  readonly attachmentName?: string | null;
}

const trimmed = (value: string | null | undefined): string =>
  (value ?? "").trim();

/** A canonical mime: one slash, no spaces. The bucket's own allowlist is the router's job. */
const MIME_SHAPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i;

/**
 * Read the three attachment fields as one value.
 *
 * Returns null for "no attachment" and a validation error for every half-filled shape, so a
 * partial attachment is a named refusal here rather than a constraint violation four layers
 * down where the message reaching the composer would be Postgres's.
 */
const readAttachment = (
  props: LeadNoteProps,
): Result<LeadNoteAttachment | null, ValidationError> => {
  const path = trimmed(props.attachmentPath);
  const type = trimmed(props.attachmentType);
  const name = trimmed(props.attachmentName);

  const filled = [path, type, name].filter((part) => part.length > 0).length;
  if (filled === 0) return ok(null);
  if (filled < 3) {
    return err(
      validation(
        "an attachment needs a file, a type and a name — all three or none",
        "attachment",
      ),
    );
  }

  const prefix = leadNoteAttachmentPrefix(props.orgId, props.leadId);
  // Must sit under THIS customer's folder, and must name an object inside it. `..` can never
  // appear in a key the app mints, so its presence means the path was assembled somewhere else.
  if (
    !path.startsWith(prefix) ||
    path.length === prefix.length ||
    path.includes("..")
  ) {
    return err(
      validation(
        "an attachment must be stored under this customer's own folder",
        "attachmentPath",
      ),
    );
  }
  if (!MIME_SHAPE.test(type)) {
    return err(validation(`"${type}" is not a file type`, "attachmentType"));
  }
  if (name.length > LEAD_NOTE_ATTACHMENT_NAME_MAX) {
    return err(
      validation(
        `a file name cannot exceed ${LEAD_NOTE_ATTACHMENT_NAME_MAX} characters`,
        "attachmentName",
      ),
    );
  }
  return ok({ path, type, name });
};

export class LeadNote {
  private constructor(private readonly p: LeadNoteProps) {}

  static create(props: LeadNoteProps): Result<LeadNote, ValidationError> {
    if (!isLeadNoteKind(props.kind)) {
      return err(validation(`unknown note kind "${props.kind}"`, "kind"));
    }
    const body = props.body.trim();
    if (body.length > LEAD_NOTE_MAX) {
      return err(
        validation(`a note cannot exceed ${LEAD_NOTE_MAX} characters`, "body"),
      );
    }

    const attachment = readAttachment(props);
    if (!attachment.ok) return err(attachment.error);

    // A call logs an outcome with no typed body ("No answer"), and so does a system entry. A
    // hand-typed note has to carry something — words, a file, or both. A photo of a panel label
    // with no sentence beside it is a real note; a note with neither is a slip, not a record.
    if (
      props.kind === "note" &&
      body.length === 0 &&
      attachment.value === null
    ) {
      return err(validation("a note needs some text or an attachment", "body"));
    }

    return ok(
      new LeadNote({
        ...props,
        body,
        attachmentPath: attachment.value?.path ?? null,
        attachmentType: attachment.value?.type ?? null,
        attachmentName: attachment.value?.name ?? null,
      }),
    );
  }

  get props(): LeadNoteProps {
    return this.p;
  }

  /** The attachment as one value, or null — so callers stop re-deriving it from three fields. */
  get attachment(): LeadNoteAttachment | null {
    const { attachmentPath, attachmentType, attachmentName } = this.p;
    if (!attachmentPath || !attachmentType || !attachmentName) return null;
    return { path: attachmentPath, type: attachmentType, name: attachmentName };
  }
}
