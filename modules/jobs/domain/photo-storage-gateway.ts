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

// Produces a signed, direct-to-storage upload URL for a job photo. The org-prefixed path is the
// isolation seam: the metadata row (job_photos) is RLS-scoped, and the bucket policy scopes reads
// to the caller's org (see 0046 storage policy). Injected; the pilot binding is
// SupabasePhotoStorageGateway (null when Supabase Storage env is unavailable — photo upload
// self-disables and the router returns PRECONDITION_FAILED).
export interface PhotoStorageGateway {
  createUploadUrl(cmd: CreateUploadUrlCmd): Promise<Result<SignedUpload, ExternalServiceError>>;
}
