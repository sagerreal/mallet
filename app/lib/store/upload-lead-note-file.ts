/**
 * lib/store/upload-lead-note-file.ts
 * Browser-only: put ONE file behind a customer note — a photo of a panel label, a signed
 * permit, the spec sheet the customer emailed over.
 *
 * The job twin (upload-job-file) does three steps and finishes by recording its own row. This
 * one deliberately stops after two: a note is one row carrying one attachment, so the note and
 * the file must be written together, and the store's `addLeadNote` is what writes it. Splitting
 * the record out is the same reason upload-chat-photo stops short — a photo with a caption is
 * one message, not two.
 *
 *   1. v1.customers.noteUploadUrl — signed URL + the storagePath the server chose
 *   2. Supabase uploadToSignedUrl — PUT the bytes, untouched
 *   3. the caller adds the note with the { path, type, name } returned here
 *
 * The bytes go up as they are: no canvas re-encode. A PDF does not survive one, and a photo of
 * a rating plate is being kept precisely so the small print stays readable.
 */

import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "@/trpc/root";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { MAX_FILE_BYTES, UnsupportedFileError, FileTooLargeError } from "./upload-job-file";

// Customer note attachments live in the SAME private bucket as job photos and job files — one
// bucket, one storage policy, one signing path. Must stay in sync with
// modules/jobs/infra/supabase-photo-storage-gateway.ts:JOB_PHOTOS_BUCKET. Inlined rather than
// imported so the @mallet/jobs barrel (and its config validator) stays out of the client bundle.
const JOB_PHOTOS_BUCKET = "job-photos";

/** Exactly what v1.customers.noteUploadUrl admits — read off the router, not retyped. */
type NoteExt = inferRouterInputs<AppRouter>["v1"]["customers"]["noteUploadUrl"]["ext"];

/**
 * Every admitted extension and the mime it is stored under.
 *
 * The set is closed for the same reason a job attachment's is: these files are served back out
 * of a private bucket, so every extension has to be one a browser renders without executing
 * anything — no svg (scriptable), no html, no office macros.
 *
 * TYPED BY THE ROUTER'S OWN ENUM, so this map cannot drift from it: add an extension server-side
 * and `Record<NoteExt, string>` fails to compile until the mime lands here too. The server enum
 * is still what actually refuses a file; this only decides what is worth sending.
 */
const ALLOWED: Readonly<Record<NoteExt, string>> = {
  pdf: "application/pdf",
  csv: "text/csv",
  txt: "text/plain",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

/** The file picker's filter, derived so it cannot list something the server would refuse. */
export const NOTE_ATTACH_ACCEPT = Object.keys(ALLOWED)
  .map((ext) => `.${ext}`)
  .join(",");

/** What a note needs to carry the file: a storage key, a mime, and a name a person recognises. */
export interface UploadedNoteAttachment {
  readonly path: string;
  readonly type: string;
  readonly name: string;
}

const extOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/**
 * Upload one attachment for a customer note.
 *
 * @returns the stored attachment, to be handed to `addLeadNote` as the note's `att`. Nothing is
 *          recorded in the database here — until the note is added, this is bytes in a bucket
 *          that no row points at.
 * @throws UnsupportedFileError / FileTooLargeError BEFORE any network call, so a rejected file
 *         costs nothing; a plain Error when the mint or the PUT genuinely fails.
 */
export async function uploadLeadNoteFile(leadId: string, file: File): Promise<UploadedNoteAttachment> {
  const ext = extOf(file.name);
  // Indexed as a plain string map: `ext` comes off a filename, so the answer must be allowed to
  // be undefined — Record<NoteExt, string> would insist it never is.
  const type = (ALLOWED as Readonly<Record<string, string>>)[ext];
  // Checked by EXTENSION, not by file.type: browsers report an empty or wrong type for plenty of
  // files, and the server's own gate is the extension in the storage key.
  if (!type) throw new UnsupportedFileError(ext || "unknown");
  if (file.size > MAX_FILE_BYTES) throw new FileTooLargeError();

  const objectId = crypto.randomUUID();
  const { storagePath, token } = await trpcVanilla.v1.customers.noteUploadUrl.mutate({
    leadId,
    objectId,
    // Safe by the lookup above: a key that is not in ALLOWED never gets here.
    ext: ext as NoteExt,
  });

  const supabase = createSupabaseBrowser();
  const { error } = await supabase.storage
    .from(JOB_PHOTOS_BUCKET)
    .uploadToSignedUrl(storagePath, token, file, { contentType: type });
  if (error) throw new Error(`file upload failed: ${error.message}`);

  // The storagePath comes back from the SERVER, not built here: the org id is in it, and the
  // client is not the authority on which org it is in.
  return { path: storagePath, type, name: file.name.slice(0, 255) };
}
