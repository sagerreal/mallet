import type { Result, ExternalServiceError } from "@mallet/shared/types";
import { ok, err, externalService } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type {
  PhotoMediaType,
  PhotoStorageGateway,
  CreateUploadUrlCmd,
  SignedUpload,
  DownloadContext,
  DownloadResult,
} from "../domain/photo-storage-gateway";

// The private bucket for job photos. Org-prefixed key layout <org_id>/<job_id>/<uuid>.<ext>.
export const JOB_PHOTOS_BUCKET = "job-photos";

// Default cap on the signed-url request so a hung Supabase Storage call cannot hang the tRPC
// request. Injectable so the unit test can drive the timeout path without a real wait.
const DEFAULT_TIMEOUT_MS = 10_000;

// Maximum photo size accepted from storage: 5 MB. Reject blobs larger than this to cap
// the memory committed per AI-run image block.
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// Supported image extensions and their canonical MIME types.
// IMAGES ONLY. download() exists to feed the AI's image blocks, and the model takes images —
// handing it a PDF would produce a confident answer about bytes it cannot read. Documents are
// stored and served to the browser, never downloaded through this path, so they are deliberately
// absent here rather than mapped and quietly mis-sent.
const EXT_TO_MEDIA_TYPE: Readonly<Record<string, PhotoMediaType>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

// The minimal slice of the Supabase client this adapter needs — kept narrow so the unit test can
// substitute a fake without depending on @supabase/supabase-js types.
interface StorageClient {
  storage: {
    from(bucket: string): {
      createSignedUploadUrl(path: string): Promise<{
        data: { signedUrl: string; token: string; path: string } | null;
        error: { message: string } | null;
      }>;
      download(path: string): Promise<{
        data: Blob | null;
        error: { message: string } | null;
      }>;
    };
  };
}

// Reject anything that could escape the org/job prefix or embed a separator.
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export class SupabasePhotoStorageGateway implements PhotoStorageGateway {
  constructor(
    private readonly getClient: () => StorageClient,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async createUploadUrl(cmd: CreateUploadUrlCmd): Promise<Result<SignedUpload, ExternalServiceError>> {
    const ext = cmd.ext.toLowerCase();
    if (!SAFE_SEGMENT.test(ext) || !SAFE_SEGMENT.test(cmd.objectId)) {
      return err(externalService("supabase-storage", "invalid photo path segment", false));
    }
    const storagePath = `${cmd.orgId}/${cmd.jobId}/${cmd.objectId}.${ext}`;
    try {
      const { data, error } = await this.withTimeout(
        this.getClient().storage.from(JOB_PHOTOS_BUCKET).createSignedUploadUrl(storagePath),
      );
      if (error || !data) {
        // Log the raw provider detail server-side; return a generic message. This AppError becomes
        // the client-facing tRPC error, and storage internals (bucket names, config) must not leak.
        logger.error(
          { err: error?.message ?? "no signed url returned", orgId: cmd.orgId, jobId: cmd.jobId },
          "supabase-storage.createSignedUploadUrl failed",
        );
        return err(externalService("supabase-storage", "the storage service is temporarily unavailable", true));
      }
      const signed: SignedUpload = { signedUrl: data.signedUrl, token: data.token, storagePath };
      return ok(signed);
    } catch (e: unknown) {
      logger.error(
        { err: e instanceof Error ? e.message : String(e), orgId: cmd.orgId, jobId: cmd.jobId },
        "supabase-storage.createSignedUploadUrl threw",
      );
      return err(externalService("supabase-storage", "the storage service is temporarily unavailable", true));
    }
  }

  async download(
    storagePath: string,
    ctx: DownloadContext,
  ): Promise<Result<DownloadResult, ExternalServiceError>> {
    // Defensive prefix check: even though the path comes from a DB row, re-validate
    // it against the verified org + job ids before fetching any bytes.
    const expectedPrefix = `${ctx.orgId}/${ctx.jobId}/`;
    if (!storagePath.startsWith(expectedPrefix)) {
      logger.error(
        { storagePath, orgId: ctx.orgId, jobId: ctx.jobId },
        "supabase-storage.download: path outside expected org/job prefix",
      );
      return err(externalService("supabase-storage", "storage path is outside the expected folder", false));
    }

    // Derive the filename portion and extract the extension.
    const filename = storagePath.slice(expectedPrefix.length);
    const dotIdx = filename.lastIndexOf(".");
    const ext = dotIdx >= 0 ? filename.slice(dotIdx + 1).toLowerCase() : "";
    const mediaType = EXT_TO_MEDIA_TYPE[ext];
    if (!mediaType) {
      return err(externalService("supabase-storage", `unsupported photo extension: ${ext}`, false));
    }

    try {
      const { data, error } = await this.withTimeout(
        this.getClient().storage.from(JOB_PHOTOS_BUCKET).download(storagePath),
      );
      if (error || !data) {
        logger.error(
          { err: error?.message ?? "no data returned", orgId: ctx.orgId, jobId: ctx.jobId },
          "supabase-storage.download failed",
        );
        return err(externalService("supabase-storage", "the storage service is temporarily unavailable", true));
      }

      const bytes = data.size;
      if (bytes > MAX_PHOTO_BYTES) {
        logger.warn(
          { bytes, orgId: ctx.orgId, jobId: ctx.jobId },
          "supabase-storage.download: photo exceeds size cap",
        );
        return err(externalService("supabase-storage", `photo exceeds the ${MAX_PHOTO_BYTES} byte size limit`, false));
      }

      const buffer = await data.arrayBuffer();
      const dataBase64 = Buffer.from(buffer).toString("base64");
      return ok({ dataBase64, mediaType, bytes });
    } catch (e: unknown) {
      logger.error(
        { err: e instanceof Error ? e.message : String(e), orgId: ctx.orgId, jobId: ctx.jobId },
        "supabase-storage.download threw",
      );
      return err(externalService("supabase-storage", "the storage service is temporarily unavailable", true));
    }
  }

  // Race the storage call against a timeout that rejects; the catch above maps it to a retryable
  // external_service error. The timer is always cleared so no dangling handle survives the race.
  private async withTimeout<T>(p: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("storage request timed out")), this.timeoutMs);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
