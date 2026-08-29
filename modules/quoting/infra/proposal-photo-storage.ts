import type { OrgId, Result, ExternalServiceError } from "@mallet/shared/types";
import { err, externalService, asJobId } from "@mallet/shared/types";
import type { PhotoStorageGateway, SignedUpload } from "@mallet/jobs";

/**
 * Photo storage for a PROPOSAL page, on top of the job-photo gateway.
 *
 * Mirrors modules/purchasing/infra/purchase-order-attachment-storage.ts folder-for-folder: same
 * private `job-photos` bucket, same signed-URL discipline, same reason for being an adapter
 * rather than a second gateway. The one thing that does not fit is the gateway's vocabulary —
 * its key layout is `<org_id>/<segment>/<object>.<ext>` with the segment typed `JobId`, and a
 * proposal photo has no job at all. So the folder token is spelled here, once.
 *
 * A proposal photo's key is `<org_id>/proposals/<uuid>.<ext>`.
 *
 * ORG-WIDE, deliberately not per-quote. The same before-and-after gets used on the next three
 * quotes the shop sends; filing it under one estimate would either duplicate the bytes or leave
 * a live quote pointing into a deleted quote's folder.
 */

/** The folder segment handed to the gateway. In one place so it can never drift. */
const PROPOSAL_FOLDER = "proposals";

/** Only what a browser can open, and only what the upload path accepts. */
export const PROPOSAL_PHOTO_EXTS = ["jpg", "jpeg", "png", "webp"] as const;
export type ProposalPhotoExt = (typeof PROPOSAL_PHOTO_EXTS)[number];

export interface ProposalPhotoUploadCmd {
  readonly orgId: OrgId;
  /** Caller-minted uuid used as the object filename. */
  readonly objectId: string;
  readonly ext: ProposalPhotoExt;
}

export class ProposalPhotoStorage {
  constructor(private readonly photos: PhotoStorageGateway) {}

  /** A signed, direct-to-storage upload URL plus the key the snapshot will record. */
  async createUploadUrl(
    cmd: ProposalPhotoUploadCmd,
  ): Promise<Result<SignedUpload, ExternalServiceError>> {
    if (!(PROPOSAL_PHOTO_EXTS as readonly string[]).includes(cmd.ext)) {
      return err(externalService("supabase-storage", "unsupported image type", false));
    }
    return this.photos.createUploadUrl({
      orgId: cmd.orgId,
      jobId: asJobId(PROPOSAL_FOLDER),
      objectId: cmd.objectId,
      ext: cmd.ext,
    });
  }

  /**
   * A short-lived link for a STORED key.
   *
   * The gateway re-validates that the path sits under `<org>/proposals/`, rejects `..`, and
   * refuses an extension it would not hand to a browser — so a snapshot whose key was somehow
   * written wrong still cannot be turned into a working URL for someone else's bytes. That
   * matters more here than anywhere: the caller on the customer's page is not logged in.
   */
  async createViewUrl(
    storagePath: string,
    orgId: OrgId,
  ): Promise<Result<{ url: string; expiresInSeconds: number }, ExternalServiceError>> {
    return this.photos.createViewUrl(storagePath, { orgId, jobId: asJobId(PROPOSAL_FOLDER) });
  }

  /**
   * Signed links for every key a snapshot references, keyed by key.
   *
   * A key that will not sign is simply absent from the map rather than failing the page: a
   * proposal whose third photo has been deleted from storage should still show the customer
   * their quote and the other two.
   */
  async createViewUrls(
    keys: readonly string[],
    orgId: OrgId,
  ): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    const unique = [...new Set(keys)];
    const signed = await Promise.all(unique.map((key) => this.createViewUrl(key, orgId)));
    unique.forEach((key, i) => {
      const result = signed[i];
      if (result?.ok) urls.set(key, result.value.url);
    });
    return urls;
  }
}
