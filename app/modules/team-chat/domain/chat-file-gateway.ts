import type { OrgId, Result, ExternalServiceError } from "@mallet/shared/types";

export interface ChatUploadUrlCmd {
  readonly orgId: OrgId;
  readonly threadId: string;
  /** Extension without the dot, validated against CHAT_EXT_TO_MEDIA_TYPE at the boundary. */
  readonly ext: string;
  /** Caller-minted uuid used as the object filename. */
  readonly objectId: string;
}

export interface ChatSignedUpload {
  readonly signedUrl: string;
  readonly token: string;
  /** &lt;org_id&gt;/&lt;thread_id&gt;/&lt;objectId&gt;.&lt;ext&gt; — recorded on the message row. */
  readonly storagePath: string;
}

/** Context for the read side: the prefix a stored path MUST match before anything is signed. */
export interface ChatDownloadContext {
  readonly orgId: OrgId;
  readonly threadId: string;
}

/**
 * Attachment storage for staff chat: the private `team-files` bucket, org-and-thread-prefixed
 * keys (&lt;org_id&gt;/&lt;thread_id&gt;/&lt;uuid&gt;.&lt;ext&gt;), and — unlike the job-photo gateway — a READ
 * side, because a chat has to render the photo it just sent.
 *
 * `createViewUrl` mints a short-lived signed URL rather than making the bucket public: the
 * caller's membership of the thread is checked in the application layer first, and a link that
 * expires cannot be pasted into a group text a year later and still work.
 *
 * Injected; null when the Supabase Storage env is unavailable, in which case attachment upload
 * self-disables and the router answers PRECONDITION_FAILED instead of half-working.
 */
export interface ChatFileGateway {
  createUploadUrl(cmd: ChatUploadUrlCmd): Promise<Result<ChatSignedUpload, ExternalServiceError>>;
  /**
   * A time-limited URL the browser can put in an &lt;img src&gt;. Re-validates the path against the
   * expected org/thread prefix before signing — the path comes from a DB row, but a row is not a
   * reason to skip the check.
   */
  createViewUrl(
    storagePath: string,
    ctx: ChatDownloadContext,
  ): Promise<Result<{ url: string; expiresInSeconds: number }, ExternalServiceError>>;
}
