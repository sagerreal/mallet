import type { Result, ExternalServiceError } from "@mallet/shared/types";
import { ok, err, externalService } from "@mallet/shared/types";
import type {
  PhotoStorageGateway,
  CreateUploadUrlCmd,
  SignedUpload,
} from "../domain/photo-storage-gateway";

// The private bucket for job photos. Org-prefixed key layout <org_id>/<job_id>/<uuid>.<ext>.
export const JOB_PHOTOS_BUCKET = "job-photos";

// Default cap on the signed-url request so a hung Supabase Storage call cannot hang the tRPC
// request. Injectable so the unit test can drive the timeout path without a real wait.
const DEFAULT_TIMEOUT_MS = 10_000;

// The minimal slice of the Supabase client this adapter needs — kept narrow so the unit test can
// substitute a fake without depending on @supabase/supabase-js types.
interface StorageClient {
  storage: {
    from(bucket: string): {
      createSignedUploadUrl(path: string): Promise<{
        data: { signedUrl: string; token: string; path: string } | null;
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
        return err(externalService("supabase-storage", error?.message ?? "no signed url returned", true));
      }
      const signed: SignedUpload = { signedUrl: data.signedUrl, token: data.token, storagePath };
      return ok(signed);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "unknown storage error";
      return err(externalService("supabase-storage", message, true));
    }
  }

  // Race the storage call against a timeout that rejects; the catch above maps it to a retryable
  // external_service error. The timer is always cleared so no dangling handle survives the race.
  private async withTimeout<T>(p: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("signed url request timed out")), this.timeoutMs);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
