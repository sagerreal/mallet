/**
 * lib/store/upload-field-photo.ts
 * Browser-only: three-step upload for the FIELD copilot camera flow.
 *
 * Uses the field-surface endpoints (v1.field.photoUploadUrl + v1.field.addPhoto)
 * which enforce tech assignment + non-terminal gates.  Returns the server-assigned
 * photo ID on success so the copilot hook can include it in the next ask.
 *
 * The office checklist flow uses upload-job-photo.ts (v1.jobs.*) — this file is
 * the field equivalent.  The three-step protocol is identical; only the tRPC
 * route differs.
 *
 * 1. v1.field.photoUploadUrl  — mint a signed URL + storagePath
 * 2. Supabase uploadToSignedUrl — PUT the bytes directly to storage
 * 3. v1.field.addPhoto         — record the metadata row; returns the photo id
 */

import { trpcVanilla } from "@/lib/trpc/vanilla";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

// Inline the bucket name to avoid pulling in @mallet/jobs barrel (which imports the router
// and triggers the DB config validator at test time). Must stay in sync with
// modules/jobs/infra/supabase-photo-storage-gateway.ts:JOB_PHOTOS_BUCKET.
const JOB_PHOTOS_BUCKET = "job-photos";

/**
 * Upload a downscaled photo Blob for the field copilot.
 *
 * @param jobId - DB uuid of the job.
 * @param blob  - Downscaled JPEG Blob from downscaleImage().
 * @returns The server-assigned photo UUID for use in the next copilot ask.
 * @throws When any of the three steps fails. Caller handles rollback.
 */
export async function uploadFieldPhoto(jobId: string, blob: Blob): Promise<string> {
  const objectId = crypto.randomUUID();
  const ext = "jpg" as const;

  const { storagePath, token } = await trpcVanilla.v1.field.photoUploadUrl.mutate({
    jobId,
    objectId,
    ext,
  });

  const supabase = createSupabaseBrowser();
  const { error } = await supabase.storage
    .from(JOB_PHOTOS_BUCKET)
    .uploadToSignedUrl(storagePath, token, blob);
  if (error) throw new Error(`field photo upload failed: ${error.message}`);

  // Record the metadata row; the server returns the updated job DTO but we only
  // need the id here — the store reconcile happens via the copilot's optimistic
  // addAddonField path, not from the photo row.
  await trpcVanilla.v1.field.addPhoto.mutate({
    jobId,
    id: objectId,
    storagePath,
    verifyPass: false,
  });

  return objectId;
}
