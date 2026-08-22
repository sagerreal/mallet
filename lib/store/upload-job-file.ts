/**
 * lib/store/upload-job-file.ts
 * Browser-only: attach a DOCUMENT to a job — a permit, a spec sheet, a supplier receipt.
 *
 * The photo twin (upload-job-photo / upload-field-photo) downscales through a canvas first, which
 * is exactly wrong here: re-encoding a PDF destroys it. So the bytes go up untouched, and the size
 * cap is enforced before the upload rather than by shrinking.
 *
 * Same three steps and the same endpoints as a photo — they are the same table and the same bucket:
 *   1. v1.jobs.photoUploadUrl  — mint a signed URL + storagePath
 *   2. Supabase uploadToSignedUrl — PUT the bytes
 *   3. v1.jobs.addPhoto        — record the row, carrying mime + the name a person recognises
 */

import { trpcVanilla } from "@/lib/trpc/vanilla";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

// Must stay in sync with modules/jobs/infra/supabase-photo-storage-gateway.ts:JOB_PHOTOS_BUCKET.
// Inlined rather than imported to keep the @mallet/jobs barrel (and its config validator) out of
// the client bundle.
const JOB_PHOTOS_BUCKET = "job-photos";

/**
 * What the server's ext enum admits. Closed on purpose: the app serves these back out of a private
 * bucket, so every extension here has to be one a browser renders without executing anything — no
 * svg (scriptable), no html, no office macros.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  csv: "text/csv",
  txt: "text/plain",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

/** 10 MB. A permit or a spec sheet is well under this; a video is not a job attachment. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export class UnsupportedFileError extends Error {
  constructor(public readonly ext: string) {
    super(`Can't attach a .${ext} file`);
    this.name = "UnsupportedFileError";
  }
}
export class FileTooLargeError extends Error {
  constructor() {
    super("That file is over 10 MB");
    this.name = "FileTooLargeError";
  }
}

const extOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/**
 * Upload one document and record it against the job.
 *
 * @returns the server-assigned attachment id.
 * @throws UnsupportedFileError / FileTooLargeError before any network call, so a rejected file
 *         costs nothing; anything else on a genuine upload or record failure.
 */
export async function uploadJobFile(jobId: string, file: File): Promise<string> {
  const ext = extOf(file.name);
  const mime = ALLOWED[ext];
  // Checked by EXTENSION, not by file.type: browsers report an empty or wrong type for plenty of
  // files, and the server's own gate is the extension in the storage key.
  if (!mime) throw new UnsupportedFileError(ext || "unknown");
  if (file.size > MAX_FILE_BYTES) throw new FileTooLargeError();

  const objectId = crypto.randomUUID();
  const { storagePath, token } = await trpcVanilla.v1.jobs.photoUploadUrl.mutate({
    jobId,
    objectId,
    ext: ext as "pdf" | "csv" | "txt" | "jpg" | "jpeg" | "png" | "webp" | "heic",
  });

  const supabase = createSupabaseBrowser();
  const { error } = await supabase.storage
    .from(JOB_PHOTOS_BUCKET)
    .uploadToSignedUrl(storagePath, token, file, { contentType: mime });
  if (error) throw new Error(`file upload failed: ${error.message}`);

  await trpcVanilla.v1.jobs.addPhoto.mutate({
    jobId,
    id: objectId,
    storagePath,
    mimeType: mime,
    // The name the person chose, kept so the attachment is findable. A storage key is a uuid.
    fileName: file.name.slice(0, 255),
    verifyPass: false,
  });

  return objectId;
}
