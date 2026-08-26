import { z } from "zod";
import {
  LEAD_NOTE_KINDS,
  LEAD_NOTE_MAX,
  LEAD_NOTE_ATTACHMENT_NAME_MAX,
  type LeadNote,
} from "../domain/lead-note";

/**
 * The wire contract for the customer activity trail, kept out of lead-router.ts so the router
 * stays a thin transport and this file is the one place the note's shape is stated.
 *
 * It is read by TWO surfaces: the customer modal's own note feed, and the job modal, which reads
 * the same `v1.customers.listNotes` live. So a field added here appears on the job for free —
 * and a field omitted here is invisible on both.
 */

/**
 * What a note's attachment may BE. Closed on purpose: storage is a private bucket the app serves
 * back through a signed link, so an extension it will hand out has to be one a browser renders
 * safely. No svg (scriptable), no html, no office macros. Same set as the job-photo allowlist —
 * the bytes share that bucket, and a type one surface accepts and the other refuses would be a
 * file that uploads from the customer and will not open on the job.
 */
export const LEAD_ATTACHMENT_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "pdf", "csv", "txt"] as const;

/** One entry in the customer activity trail. Shapes 1:1 onto the store's LeadNote. */
export const leadNoteDTO = z.object({
  id: z.string().uuid(),
  leadId: z.string().uuid(),
  kind: z.enum(LEAD_NOTE_KINDS),
  body: z.string(),
  author: z.string().nullable(),
  direction: z.string().nullable(),
  outcome: z.string().nullable(),
  durationLabel: z.string().nullable(),
  via: z.string().nullable(),
  overnight: z.boolean(),
  createdAt: z.string(),
  /**
   * The note's ONE attachment, or three nulls. The storage KEY rides the wire, never a URL: a
   * link is minted on demand by noteViewUrl and expires, so a page left open overnight cannot
   * become a permanent public handle on a customer's permit. All three move together — the
   * `lead_notes_attachment_shape_check` constraint enforces that at rest.
   */
  attachmentPath: z.string().nullable(),
  attachmentType: z.string().nullable(),
  attachmentName: z.string().nullable(),
});

export const toLeadNoteDTO = (note: LeadNote) => {
  const p = note.props;
  return {
    id: p.id,
    leadId: p.leadId as string,
    kind: p.kind,
    body: p.body,
    author: p.author,
    direction: p.direction,
    outcome: p.outcome,
    durationLabel: p.durationLabel,
    via: p.via,
    overnight: p.overnight,
    createdAt: p.createdAt.toISOString(),
    // `?? null` rather than a bare read: the props are optional, and an absent key would fail
    // the DTO's `.nullable()` rather than answering "no attachment".
    attachmentPath: p.attachmentPath ?? null,
    attachmentType: p.attachmentType ?? null,
    attachmentName: p.attachmentName ?? null,
  };
};

export const addNoteInput = z.object({
  // Client-authored so the store can hand the id out synchronously — the home queue's
  // 30s Undo deletes exactly the note a Send appended.
  id: z.string().uuid(),
  leadId: z.string().uuid(),
  kind: z.enum(LEAD_NOTE_KINDS),
  body: z.string().max(LEAD_NOTE_MAX),
  author: z.string().max(120).nullable().optional(),
  direction: z.string().max(20).nullable().optional(),
  outcome: z.string().max(120).nullable().optional(),
  durationLabel: z.string().max(20).nullable().optional(),
  via: z.string().max(60).nullable().optional(),
  overnight: z.boolean().optional(),
  /**
   * The upload this note is being saved with, if any. Present or absent as a WHOLE — the three
   * parts cannot be sent separately, so the all-or-none shape the database checks cannot be
   * violated by a partial payload. `path` is still re-validated in the domain against the
   * caller's own org and lead: it arrives from the browser, and noteUploadUrl having minted one
   * like it is not proof this is the one.
   */
  attachment: z
    .object({
      path: z.string().min(1).max(1024),
      type: z.string().min(1).max(120),
      // Same ceiling the domain enforces, so an over-long name is one refusal, not two.
      name: z.string().min(1).max(LEAD_NOTE_ATTACHMENT_NAME_MAX),
    })
    .optional(),
});

/** Mint a signed, direct-to-storage upload URL for a customer note's attachment. */
export const noteUploadUrlInput = z.object({
  leadId: z.string().uuid(),
  objectId: z.string().uuid(),
  ext: z.enum(LEAD_ATTACHMENT_EXTS),
});
export const noteUploadUrlDTO = z.object({
  signedUrl: z.string(),
  token: z.string(),
  storagePath: z.string(),
});

/**
 * Open one stored attachment.
 *
 * The caller names the ROW, never the storage path: the server looks the note up inside the
 * tenant tx and reads the path off it. A client that guessed another org's key would still be
 * asking for a row it cannot see, and gets NOT_FOUND.
 */
export const noteViewUrlInput = z.object({
  leadId: z.string().uuid(),
  id: z.string().uuid(),
});
export const noteViewUrlDTO = z.object({ url: z.string() });
