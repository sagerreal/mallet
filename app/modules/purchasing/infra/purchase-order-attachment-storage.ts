import type { OrgId, Result, ExternalServiceError } from "@mallet/shared/types";
import { err, externalService, asJobId } from "@mallet/shared/types";
import type { PhotoStorageGateway, SignedUpload } from "@mallet/jobs";

/**
 * Attachment storage for a PURCHASE ORDER note, on top of the job-photo gateway.
 *
 * Mirrors modules/customers/infra/lead-attachment-storage.ts folder-for-folder: same private
 * `job-photos` bucket, same signed-URL discipline, same reason for being an adapter rather than a
 * second gateway (see that file's header comment). The one thing that does not fit is its
 * vocabulary — the gateway's key layout is `<org_id>/<segment>/<object>.<ext>` with the segment
 * parameter typed `JobId`, and a PO note has no job of its own. So the folder token is spelled
 * here, once, and every call goes through this class.
 *
 * A note's key is `<org_id>/purchase-orders/<po_id>/<uuid>.<ext>`.
 */

/** Reject anything that could escape the org/PO folder or embed a separator. */
const SAFE_SEGMENT = /^[A-Za-z0-9-]+$/;

/** The folder segment handed to the gateway. Kept in one place so it can never drift. */
const poFolder = (poId: string): string => `purchase-orders/${poId}`;

export interface POUploadUrlCmd {
  readonly orgId: OrgId;
  readonly poId: string;
  /** Caller-minted uuid used as the object filename. */
  readonly objectId: string;
  /** Extension without the dot. The router's enum is the real allowlist. */
  readonly ext: string;
}

export interface POAttachmentViewContext {
  readonly orgId: OrgId;
  readonly poId: string;
}

export class PurchaseOrderAttachmentStorage {
  constructor(private readonly photos: PhotoStorageGateway) {}

  /**
   * A signed, direct-to-storage upload URL plus the key the note row will record.
   *
   * The PO id is re-checked against SAFE_SEGMENT even though the router parsed it as a uuid: this
   * is the call that decides which folder bytes land in, so it derives the folder from a value it
   * has itself verified rather than from one it was handed.
   */
  async createUploadUrl(cmd: POUploadUrlCmd): Promise<Result<SignedUpload, ExternalServiceError>> {
    if (!SAFE_SEGMENT.test(cmd.poId)) {
      return err(externalService("supabase-storage", "invalid attachment path segment", false));
    }
    return this.photos.createUploadUrl({
      orgId: cmd.orgId,
      jobId: asJobId(poFolder(cmd.poId)),
      objectId: cmd.objectId,
      ext: cmd.ext,
    });
  }

  /**
   * A short-lived link the browser can open, minted from a STORED path.
   *
   * The underlying gateway re-validates that the path sits under `<org>/purchase-orders/<po>/`,
   * rejects `..`, and refuses an extension it would not hand to a browser — so a row whose path
   * was somehow written wrong still cannot be turned into a working URL for someone else's bytes.
   */
  async createViewUrl(
    storagePath: string,
    ctx: POAttachmentViewContext,
  ): Promise<Result<{ url: string; expiresInSeconds: number }, ExternalServiceError>> {
    if (!SAFE_SEGMENT.test(ctx.poId)) {
      return err(externalService("supabase-storage", "invalid attachment path segment", false));
    }
    return this.photos.createViewUrl(storagePath, {
      orgId: ctx.orgId,
      jobId: asJobId(poFolder(ctx.poId)),
    });
  }
}
