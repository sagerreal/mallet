import type { Result, ExternalServiceError } from "@mallet/shared/types";
import { ok, err, externalService } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { CHAT_EXT_TO_MEDIA_TYPE } from "../domain/team-message";
import type {
  ChatFileGateway,
  ChatUploadUrlCmd,
  ChatSignedUpload,
  ChatDownloadContext,
} from "../domain/chat-file-gateway";

/** The private bucket for staff-chat attachments. Keys: <org_id>/<thread_id>/<uuid>.<ext>. */
export const TEAM_FILES_BUCKET = "team-files";

/** A hung Storage call must not hang the tRPC request. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * How long a view link lives. Long enough to open a thread, scroll, and look; short enough that
 * a copied URL is not a permanent public handle on the shop's photo. The client re-requests on
 * demand, so expiry is invisible in normal use.
 */
export const VIEW_URL_TTL_SECONDS = 300;

/** Reject anything that could escape the org/thread prefix or embed a separator. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** The minimal slice of the Supabase client this adapter needs, so tests can substitute a fake. */
interface StorageClient {
  storage: {
    from(bucket: string): {
      createSignedUploadUrl(path: string): Promise<{
        data: { signedUrl: string; token: string; path: string } | null;
        error: { message: string } | null;
      }>;
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Promise<{
        data: { signedUrl: string } | null;
        error: { message: string } | null;
      }>;
    };
  };
}

export class SupabaseChatFileGateway implements ChatFileGateway {
  constructor(
    private readonly getClient: () => StorageClient,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async createUploadUrl(
    cmd: ChatUploadUrlCmd,
  ): Promise<Result<ChatSignedUpload, ExternalServiceError>> {
    const ext = cmd.ext.toLowerCase();
    // Two gates, not one: the extension must be a type we will render, AND every segment must be
    // free of separators. The first keeps an .html or .svg out of the bucket entirely; the second
    // keeps a crafted objectId from climbing out of the thread's folder.
    if (!(ext in CHAT_EXT_TO_MEDIA_TYPE)) {
      return err(externalService("supabase-storage", "unsupported attachment type", false));
    }
    if (!SAFE_SEGMENT.test(ext) || !SAFE_SEGMENT.test(cmd.objectId) || !SAFE_SEGMENT.test(cmd.threadId)) {
      return err(externalService("supabase-storage", "invalid attachment path segment", false));
    }

    const storagePath = `${cmd.orgId}/${cmd.threadId}/${cmd.objectId}.${ext}`;
    try {
      const { data, error } = await this.withTimeout(
        this.getClient().storage.from(TEAM_FILES_BUCKET).createSignedUploadUrl(storagePath),
      );
      if (error || !data) {
        // Provider detail is logged server-side; the client gets a generic message so bucket
        // names and storage config never leak into a UI error.
        logger.warn(
          { threadId: cmd.threadId, detail: error?.message ?? "no data" },
          "teamChat.upload_url_failed",
        );
        return err(externalService("supabase-storage", "could not start the upload", true));
      }
      return ok({ signedUrl: data.signedUrl, token: data.token, storagePath });
    } catch (unknownErr: unknown) {
      const detail = unknownErr instanceof Error ? unknownErr.message : "unknown";
      logger.warn({ threadId: cmd.threadId, detail }, "teamChat.upload_url_error");
      return err(externalService("supabase-storage", "could not start the upload", true));
    }
  }

  async createViewUrl(
    storagePath: string,
    ctx: ChatDownloadContext,
  ): Promise<Result<{ url: string; expiresInSeconds: number }, ExternalServiceError>> {
    // The path came out of a DB row, but re-validate the prefix anyway: this is the one call
    // that hands a caller bytes, so it re-derives what it is allowed to hand over rather than
    // trusting what it was given.
    const expectedPrefix = `${ctx.orgId}/${ctx.threadId}/`;
    if (!storagePath.startsWith(expectedPrefix) || storagePath.includes("..")) {
      logger.warn({ threadId: ctx.threadId }, "teamChat.view_url_prefix_rejected");
      return err(externalService("supabase-storage", "attachment path is not valid", false));
    }
    const ext = storagePath.split(".").pop()?.toLowerCase() ?? "";
    if (!(ext in CHAT_EXT_TO_MEDIA_TYPE)) {
      return err(externalService("supabase-storage", "attachment type is not viewable", false));
    }

    try {
      const { data, error } = await this.withTimeout(
        this.getClient()
          .storage.from(TEAM_FILES_BUCKET)
          .createSignedUrl(storagePath, VIEW_URL_TTL_SECONDS),
      );
      if (error || !data) {
        logger.warn(
          { threadId: ctx.threadId, detail: error?.message ?? "no data" },
          "teamChat.view_url_failed",
        );
        return err(externalService("supabase-storage", "could not open the attachment", true));
      }
      return ok({ url: data.signedUrl, expiresInSeconds: VIEW_URL_TTL_SECONDS });
    } catch (unknownErr: unknown) {
      const detail = unknownErr instanceof Error ? unknownErr.message : "unknown";
      logger.warn({ threadId: ctx.threadId, detail }, "teamChat.view_url_error");
      return err(externalService("supabase-storage", "could not open the attachment", true));
    }
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`supabase storage timed out after ${this.timeoutMs}ms`)),
        this.timeoutMs,
      );
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e: unknown) => {
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  }
}
