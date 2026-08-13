/**
 * lib/store/upload-chat-photo.ts
 * Browser-only: mint a signed upload URL, PUT the photo straight to Supabase Storage, and hand
 * the caller the facts a message row needs. Mirrors upload-field-photo.ts — the same three-step
 * protocol, against the team-files bucket.
 *
 *   1. teamChat.attachmentUploadUrl — tRPC: membership check, then a signed URL + storagePath
 *   2. uploadToSignedUrl            — Supabase Storage: PUT the bytes
 *   3. the caller sends the message with { path, mediaType, bytes }
 *
 * The message send is NOT done here: a photo with a caption is one message, so the composer owns
 * that call and this returns the attachment it just stored.
 */

import { trpcVanilla } from "@/lib/trpc/vanilla";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { downscaleImage } from "@/lib/images/downscale";

/** Inlined rather than imported from the module barrel — a barrel pulls the API router. */
const TEAM_FILES_BUCKET = "team-files";

export interface UploadedChatPhoto {
  readonly path: string;
  readonly mediaType: "image/jpeg";
  readonly bytes: number;
}

/**
 * Upload one photo for a thread.
 *
 * Everything is normalised to JPEG by downscaleImage before it leaves the device: it caps the long
 * edge at 1568px and re-encodes, which is what makes an iPhone HEIC uploadable at all and keeps a
 * 12MP photo well under the 10MB ceiling the bucket enforces.
 *
 * @throws when the URL mint or the PUT fails. The caller rolls back its optimistic bubble.
 */
export async function uploadChatPhoto(threadId: string, file: File): Promise<UploadedChatPhoto> {
  const blob = await downscaleImage(file);
  const objectId = crypto.randomUUID();

  const { storagePath, token } = await trpcVanilla.v1.teamChat.attachmentUploadUrl.mutate({
    threadId,
    objectId,
    // downscaleImage always emits JPEG, so the extension is not a guess about the input file.
    ext: "jpg",
  });

  const supabase = createSupabaseBrowser();
  const { error } = await supabase.storage
    .from(TEAM_FILES_BUCKET)
    .uploadToSignedUrl(storagePath, token, blob);
  if (error) throw new Error(`photo upload failed: ${error.message}`);

  return { path: storagePath, mediaType: "image/jpeg", bytes: blob.size };
}
