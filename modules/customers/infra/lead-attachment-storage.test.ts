import { describe, it, expect, vi } from "vitest";
import { asOrgId, asLeadId, ok, err, externalService } from "@mallet/shared/types";
import type { PhotoStorageGateway } from "@mallet/jobs";
import { leadNoteAttachmentPrefix } from "../domain/lead-note";
import { LeadAttachmentStorage } from "./lead-attachment-storage";

/**
 * The adapter that lets a CUSTOMER note keep its bytes in the job-photo bucket.
 *
 * Its whole job is the folder token, so that is what these assert. The failure it exists to
 * prevent is a silent disagreement with the domain: if the key it mints and the prefix the
 * domain accepts ever drift apart, every upload succeeds and every save is refused — a bug that
 * looks like "attachments are broken" and reads, in the code, like two correct functions.
 */

const ORG = asOrgId("22222222-2222-4222-8222-222222222222");
const LEAD = asLeadId("11111111-1111-4111-8111-111111111111");

const gateway = (over: Partial<PhotoStorageGateway> = {}): PhotoStorageGateway => ({
  createUploadUrl: vi.fn(async (cmd) =>
    ok({ signedUrl: "https://s/u", token: "t", storagePath: `${cmd.orgId}/${cmd.jobId}/${cmd.objectId}.${cmd.ext}` }),
  ),
  download: vi.fn(async () => err(externalService("supabase-storage", "unused", false))),
  createViewUrl: vi.fn(async () => ok({ url: "https://s/v", expiresInSeconds: 300 })),
  ...over,
});

describe("LeadAttachmentStorage", () => {
  it("keys the object under the customer's own folder", async () => {
    const gw = gateway();
    const r = await new LeadAttachmentStorage(gw).createUploadUrl({
      orgId: ORG,
      leadId: LEAD,
      objectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ext: "jpg",
    });
    expect(r.ok && r.value.storagePath).toBe(
      `${ORG}/leads/${LEAD}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`,
    );
  });

  // The one assertion that makes the drift impossible rather than unlikely.
  it("mints a key the DOMAIN would accept", async () => {
    const gw = gateway();
    const r = await new LeadAttachmentStorage(gw).createUploadUrl({
      orgId: ORG,
      leadId: LEAD,
      objectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ext: "pdf",
    });
    expect(r.ok && r.value.storagePath.startsWith(leadNoteAttachmentPrefix(ORG, LEAD))).toBe(true);
  });

  it("asks the gateway to sign the exact stored path, in the same folder", async () => {
    const gw = gateway();
    const path = `${ORG}/leads/${LEAD}/bb.pdf`;
    await new LeadAttachmentStorage(gw).createViewUrl(path, { orgId: ORG, leadId: LEAD });
    expect(gw.createViewUrl).toHaveBeenCalledWith(path, { orgId: ORG, jobId: `leads/${LEAD}` });
  });

  // A lead id is a uuid by the time it reaches here, but this is the call that decides which
  // folder bytes land in — it verifies the segment itself rather than trusting the caller.
  it("refuses a lead segment that could climb out of the folder", async () => {
    const gw = gateway();
    const r = await new LeadAttachmentStorage(gw).createUploadUrl({
      orgId: ORG,
      leadId: asLeadId("../../other-org"),
      objectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ext: "jpg",
    });
    expect(r.ok).toBe(false);
    expect(gw.createUploadUrl).not.toHaveBeenCalled();
  });

  it("passes a storage failure back rather than inventing a link", async () => {
    const gw = gateway({
      createViewUrl: vi.fn(async () => err(externalService("supabase-storage", "unavailable", true))),
    });
    const r = await new LeadAttachmentStorage(gw).createViewUrl(`${ORG}/leads/${LEAD}/bb.pdf`, {
      orgId: ORG,
      leadId: LEAD,
    });
    expect(r.ok).toBe(false);
  });
});
