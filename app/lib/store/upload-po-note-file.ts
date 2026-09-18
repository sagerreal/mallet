/**
 * lib/store/upload-po-note-file.ts
 * Browser-only: put ONE file behind a purchase-order note — a photo of the counter receipt, a
 * packing-slip, a supply-house invoice PDF.
 *
 * Mirrors upload-lead-note-file.ts folder-for-folder (same private `job-photos` bucket, same
 * signed-URL discipline, same two-steps-then-the-caller-writes-the-note shape):
 *   1. v1.purchasing.noteUploadUrl — signed URL + the storagePath the server chose
 *   2. Supabase uploadToSignedUrl — PUT the bytes, untouched
 *   3. the caller adds the note with the { path, type, name } returned here
 *
 * The bytes go up as they are: no canvas re-encode. A photo of a receipt is being kept precisely
 * so the total line stays readable.
 */

import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "@/trpc/root";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { MAX_FILE_BYTES, UnsupportedFileError, FileTooLargeError } from "./upload-job-file";

// PO note attachments live in the SAME private bucket as job photos, job files and lead-note
// attachments — one bucket, one storage policy, one signing path. Must stay in sync with
// modules/jobs/infra/supabase-photo-storage-gateway.ts:JOB_PHOTOS_BUCKET. Inlined rather than
// imported so the @mallet/jobs barrel (and its config validator) stays out of the client bundle.
const JOB_PHOTOS_BUCKET = "job-photos";

/** Exactly what v1.purchasing.noteUploadUrl admits — read off the router, not retyped. */
type PONoteExt = inferRouterInputs<AppRouter>["v1"]["purchasing"]["noteUploadUrl"]["ext"];

/**
 * Every admitted extension and the mime it is stored under. Identical allowlist to
 * upload-lead-note-file.ts's ALLOWED — modules/purchasing/api/purchase-order-router.ts's own
 * PO_ATTACHMENT_EXTS comment says so ("the bytes share the same private bucket, so a type one
 * surface accepts and the other refuses would be a file that uploads here and will not open
 * there") — typed by THIS router's own enum so it cannot silently drift from it.
 */
const ALLOWED: Readonly<Record<PONoteExt, string>> = {
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
export const PO_NOTE_ATTACH_ACCEPT = Object.keys(ALLOWED)
  .map((ext) => `.${ext}`)
  .join(",");

/** What a note needs to carry the file: a storage key, a mime, and a name a person recognises. */
export interface UploadedPONoteAttachment {
  readonly path: string;
  readonly type: string;
  readonly name: string;
}

const extOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/**
 * Upload one attachment for a purchase-order note.
 *
 * @returns the stored attachment, to be handed to `appendPONote` as the note's `attachment`.
 *          Nothing is recorded in the database here — until the note is added, this is bytes in
 *          a bucket that no row points at.
 * @throws UnsupportedFileError / FileTooLargeError BEFORE any network call, so a rejected file
 *         costs nothing; a plain Error when the mint or the PUT genuinely fails.
 */
export async function uploadPONoteFile(poId: string, file: File): Promise<UploadedPONoteAttachment> {
  const ext = extOf(file.name);
  // Indexed as a plain string map: `ext` comes off a filename, so the answer must be allowed to
  // be undefined — Record<PONoteExt, string> would insist it never is.
  const type = (ALLOWED as Readonly<Record<string, string>>)[ext];
  // Checked by EXTENSION, not by file.type: browsers report an empty or wrong type for plenty of
  // files, and the server's own gate is the extension in the storage key.
  if (!type) throw new UnsupportedFileError(ext || "unknown");
  if (file.size > MAX_FILE_BYTES) throw new FileTooLargeError();

  const objectId = crypto.randomUUID();
  const { storagePath, token } = await trpcVanilla.v1.purchasing.noteUploadUrl.mutate({
    poId,
    objectId,
    // Safe by the lookup above: a key that is not in ALLOWED never gets here.
    ext: ext as PONoteExt,
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
