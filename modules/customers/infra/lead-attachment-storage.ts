import type { OrgId, LeadId, Result, ExternalServiceError } from "@mallet/shared/types";
import { err, externalService, asJobId } from "@mallet/shared/types";
import type { PhotoStorageGateway, SignedUpload } from "@mallet/jobs";
import { leadNoteAttachmentPrefix } from "../domain/lead-note";

/**
 * Attachment storage for a CUSTOMER note, on top of the job-photo gateway.
 *
 * Why an adapter rather than a second gateway: the bytes belong in the SAME private
 * `job-photos` bucket, and the existing adapter already carries the parts that are easy to get
 * wrong — the request timeout, the "log the provider detail, return a generic message" posture,
 * the `..` rejection, and the closed set of extensions a browser will render safely. A parallel
 * class in this module would have to restate all four and would drift from them.
 *
 * The one thing that does NOT fit is its vocabulary: its key layout is
 * `<org_id>/<segment>/<object>.<ext>` but the segment parameter is typed `JobId`, and a customer
 * note has no job. So the folder token is spelled here, once, and every call goes through this
 * class — the cast lives in exactly one place with this comment next to it, instead of being
 * repeated at each call site where the next reader would take it for a real job id.
 *
 * A note's key is `<org_id>/leads/<lead_id>/<uuid>.<ext>`. The literal `leads` segment keeps
 * customer attachments from ever colliding with a job folder: a job id is a uuid, so no job
 * folder can be named "leads".
 */

/**
 * The folder segment this adapter hands the gateway, derived from the DOMAIN's prefix rather
 * than spelled a second time. The domain is what refuses a note whose path sits elsewhere, so
 * if the two ever disagreed every upload would succeed and every save would be rejected —
 * deriving one from the other makes that impossible instead of merely unlikely.
 */
const leadFolder = (orgId: OrgId, leadId: LeadId): string =>
  leadNoteAttachmentPrefix(orgId, leadId).slice(`${orgId}/`.length).replace(/\/$/, "");

/** Reject anything that could escape the org/lead folder or embed a separator. */
const SAFE_SEGMENT = /^[A-Za-z0-9-]+$/;

export interface LeadUploadUrlCmd {
  readonly orgId: OrgId;
  readonly leadId: LeadId;
  /** Caller-minted uuid used as the object filename. */
  readonly objectId: string;
  /** Extension without the dot. The router's enum is the real allowlist. */
  readonly ext: string;
}

export interface LeadViewContext {
  readonly orgId: OrgId;
  readonly leadId: LeadId;
}

export class LeadAttachmentStorage {
  constructor(private readonly photos: PhotoStorageGateway) {}

  /**
   * A signed, direct-to-storage upload URL plus the key the note row will record.
   *
   * The lead id is re-checked against SAFE_SEGMENT even though the router parsed it as a uuid:
   * this is the call that decides which folder bytes land in, so it derives the folder from a
   * value it has itself verified rather than from one it was handed.
   */
  async createUploadUrl(cmd: LeadUploadUrlCmd): Promise<Result<SignedUpload, ExternalServiceError>> {
    if (!SAFE_SEGMENT.test(cmd.leadId as string)) {
      return err(externalService("supabase-storage", "invalid attachment path segment", false));
    }
    return this.photos.createUploadUrl({
      orgId: cmd.orgId,
      jobId: asJobId(leadFolder(cmd.orgId, cmd.leadId)),
      objectId: cmd.objectId,
      ext: cmd.ext,
    });
  }

  /**
   * A short-lived link the browser can open, minted from a STORED path.
   *
   * The underlying gateway re-validates that the path sits under `<org>/leads/<lead>/`, rejects
   * `..`, and refuses an extension it would not hand to a browser — so a row whose path was
   * somehow written wrong still cannot be turned into a working URL for someone else's bytes.
   */
  async createViewUrl(
    storagePath: string,
    ctx: LeadViewContext,
  ): Promise<Result<{ url: string; expiresInSeconds: number }, ExternalServiceError>> {
    if (!SAFE_SEGMENT.test(ctx.leadId as string)) {
      return err(externalService("supabase-storage", "invalid attachment path segment", false));
    }
    return this.photos.createViewUrl(storagePath, {
      orgId: ctx.orgId,
      jobId: asJobId(leadFolder(ctx.orgId, ctx.leadId)),
    });
  }
}
