/**
 * lib/store/upload-job-photo.ts
 * Browser-only: mint a signed upload URL, PUT the file directly to Supabase Storage, then record
 * the metadata row. Returns the storage path on success. Errors bubble to the caller for rollback.
 *
 * This is the REAL photo-upload path. UI wiring (calling this from addJobPhoto or a separate
 * handler) is a later task — this module is the single place for the three-step upload protocol:
 *   1. photoUploadUrl  — tRPC: mint a signed URL + storagePath
 *   2. uploadToSignedUrl — Supabase Storage: PUT the file bytes
 *   3. addPhoto         — tRPC: record the metadata row and optionally pass a verify item
 */

import { trpcVanilla } from "@/lib/trpc/vanilla";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { JOB_PHOTOS_BUCKET } from "@mallet/jobs";

/**
 * Upload a photo file for a job.
 *
 * @param jobId      - DB uuid of the job.
 * @param file       - File selected by the tech.
 * @param verifyPass - When true, the addPhoto use-case marks the next photo checklist item as passed.
 * @returns The storagePath recorded in the DB row on success.
 * @throws When any step fails (signed URL mint, upload, or metadata record). Callers should roll back.
 */
export async function uploadJobPhoto(jobId: string, file: File, verifyPass: boolean): Promise<string> {
  const objectId = crypto.randomUUID();
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";

  const { storagePath, token } = await trpcVanilla.v1.jobs.photoUploadUrl.mutate({
    jobId,
    objectId,
    ext,
  });

  const supabase = createSupabaseBrowser();
  const { error } = await supabase.storage.from(JOB_PHOTOS_BUCKET).uploadToSignedUrl(storagePath, token, file);
  if (error) throw new Error(`photo upload failed: ${error.message}`);

  await trpcVanilla.v1.jobs.addPhoto.mutate({ jobId, storagePath, verifyPass });

  return storagePath;
}
