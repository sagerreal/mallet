/**
 * lib/store/upload-proposal-photo.ts
 * Browser-only: put a photo on a proposal page.
 *
 * Two steps, not the job path's three — a proposal photo has no metadata row. Its key lives in
 * the quote's own presentation snapshot, so the caller records it there:
 *   1. v1.quoting.proposalPhotoUploadUrl — mint a signed URL + the key
 *   2. uploadToSignedUrl                 — PUT the bytes
 *
 * ORG-WIDE storage, deliberately not per-quote: the same before-and-after gets used on the next
 * three quotes the shop sends.
 */

import { trpcVanilla } from "@/lib/trpc/vanilla";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

// Must stay in sync with modules/jobs/infra/supabase-photo-storage-gateway.ts:JOB_PHOTOS_BUCKET.
// Inlined rather than imported to keep the @mallet/jobs barrel (and its config validator) out of
// the client bundle — the same reason upload-job-file.ts inlines it.
const JOB_PHOTOS_BUCKET = "job-photos";

/**
 * What the server's ext enum admits. Closed on purpose: these are served back out of a private
 * bucket to a page anyone with the link can open, so every type here has to be one a browser
 * renders without executing anything — no svg, which is scriptable.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** 5 MB, the same cap the storage gateway enforces on the way back out. */
export const MAX_PROPOSAL_PHOTO_BYTES = 5 * 1024 * 1024;

export class UnsupportedImageError extends Error {
  constructor() {
    super("That file type can't go on a proposal — use a JPG, PNG or WebP.");
    this.name = "UnsupportedImageError";
  }
}

export class ImageTooLargeError extends Error {
  constructor() {
    super("That image is too large — proposals take images up to 5 MB.");
    this.name = "ImageTooLargeError";
  }
}

/** The extension the server will accept for this file, or null when it will not take it. */
function extensionOf(file: File): keyof typeof ALLOWED | null {
  const byName = (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (byName in ALLOWED) return byName;
  // A pasted image often arrives with no filename at all — fall back to what the clipboard says
  // it is, which is the whole reason paste works.
  const byType = Object.entries(ALLOWED).find(([, mime]) => mime === file.type)?.[0];
  return byType ?? null;
}

/**
 * Upload one image and return the KEY to record on the page. Never a URL: a URL would either be
 * public forever or expire inside a snapshot meant to be permanent.
 */
export async function uploadProposalPhoto(file: File): Promise<string> {
  const ext = extensionOf(file);
  if (!ext) throw new UnsupportedImageError();
  if (file.size > MAX_PROPOSAL_PHOTO_BYTES) throw new ImageTooLargeError();

  const { storagePath, token } = await trpcVanilla.v1.quoting.proposalPhotoUploadUrl.mutate({
    objectId: crypto.randomUUID(),
    ext: ext as "jpg" | "jpeg" | "png" | "webp",
  });

  const supabase = createSupabaseBrowser();
  const { error } = await supabase.storage
    .from(JOB_PHOTOS_BUCKET)
    .uploadToSignedUrl(storagePath, token, file, { contentType: ALLOWED[ext] });
  if (error) throw new Error(`photo upload failed: ${error.message}`);

  return storagePath;
}
