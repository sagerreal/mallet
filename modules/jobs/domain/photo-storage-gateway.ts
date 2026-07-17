import type { OrgId, JobId, Result, ExternalServiceError } from "@mallet/shared/types";

export interface CreateUploadUrlCmd {
  readonly orgId: OrgId;
  readonly jobId: JobId;
  readonly ext: string; // file extension without dot, e.g. "jpg"
  readonly objectId: string; // the caller-minted uuid used as the object filename
}

export interface SignedUpload {
  readonly signedUrl: string; // the URL the browser PUTs the file to
  readonly token: string; // token the browser passes to uploadToSignedUrl
  readonly storagePath: string; // <org_id>/<job_id>/<objectId>.<ext> — recorded on the row
}

// Context passed to download() for prefix re-validation — the path comes from a DB row but is
// checked defensively against the verified org + job ids before any fetch.
export interface DownloadContext {
  readonly orgId: OrgId;
  readonly jobId: JobId;
}

// The only media types the pipeline accepts — matches EXT_TO_MEDIA_TYPE in the adapter
// and the LLM port's image block union. Narrowed HERE so a future map extension that
// forgets the union fails to compile instead of silently passing a cast.
export type PhotoMediaType = "image/jpeg" | "image/png" | "image/webp";

export interface DownloadResult {
  readonly dataBase64: string;
  readonly mediaType: PhotoMediaType;
  readonly bytes: number;
}

// Produces a signed, direct-to-storage upload URL for a job photo. The org-prefixed path is the
// isolation seam: the metadata row (job_photos) is RLS-scoped, and the bucket policy scopes reads
// to the caller's org (see 0046 storage policy). Injected; the pilot binding is
// SupabasePhotoStorageGateway (null when Supabase Storage env is unavailable — photo upload
// self-disables and the router returns PRECONDITION_FAILED).
export interface PhotoStorageGateway {
  createUploadUrl(cmd: CreateUploadUrlCmd): Promise<Result<SignedUpload, ExternalServiceError>>;
  // Downloads a stored photo, verifying it belongs to the expected org/job folder.
  // Returns base64-encoded image data and the inferred media type. Rejects paths
  // that don't match the expected org/job prefix, unknown extensions, and files > 5MB.
  download(storagePath: string, ctx: DownloadContext): Promise<Result<DownloadResult, ExternalServiceError>>;
}
