import { describe, it, expect, vi } from "vitest";
import { TwilioA2pGateway, type A2pOps } from "./twilio-a2p-gateway";
import type { BusinessInfo } from "../domain/registration";

const info = {
  legalName: "Summit Plumbing",
  ein: "12-3456789",
  addressStreet: "200 Ray St",
  addressCity: "Pleasanton",
  addressRegion: "CA",
  addressPostal: "94566",
  industry: "CONSTRUCTION",
  websiteUrl: "https://s.example",
  contactFirstName: "Sam",
  contactLastName: "Rivera",
  contactEmail: "sam@s.example",
  contactPhone: "+19255550100",
} as BusinessInfo;

const okOps = (): A2pOps => ({
  createCustomerProfile: vi.fn(async () => ({ sid: "BUxxx" })),
  createEndUser: vi.fn(async () => ({ sid: "IThuman" })),
  createAddress: vi.fn(async () => ({ sid: "ADxxx" })),
  createSupportingDocument: vi.fn(async () => ({ sid: "RDxxx" })),
  assignEntity: vi.fn(async () => undefined),
  evaluateProfile: vi.fn(async () => ({ status: "compliant" as const })),
  submitProfile: vi.fn(async () => undefined),
  createBrand: vi.fn(async () => ({ sid: "BNxxx" })),
  createMessagingService: vi.fn(async () => ({ sid: "MGxxx" })),
  createCampaign: vi.fn(async () => ({ sid: "QExxx" })),
  attachNumberToService: vi.fn(async () => undefined),
  fetchProfileStatus: vi.fn(async () => "approved" as const),
  fetchBrandStatus: vi.fn(async () => "approved" as const),
  fetchCampaignStatus: vi.fn(async (_cmd: { messagingServiceSid: string; campaignSid: string }) => "approved" as const),
});

describe("TwilioA2pGateway", () => {
  it("createSecondaryProfile runs the full TrustHub assembly and returns the profile SID", async () => {
    const ops = okOps();
    const gw = new TwilioA2pGateway("AC", "tok", "BUprimary", "https://cb", ops);
    const r = await gw.createSecondaryProfile({ orgId: "o1", info });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.profileSid).toBe("BUxxx");
    expect(ops.createCustomerProfile).toHaveBeenCalledOnce();
    expect(ops.submitProfile).toHaveBeenCalledWith("BUxxx");
  });

  it("classifies a 4xx from a step as a non-retryable ExternalServiceError", async () => {
    const ops = okOps();
    ops.createBrand = vi.fn(async () => {
      throw Object.assign(new Error("bad"), { status: 400, code: 21650 });
    });
    const gw = new TwilioA2pGateway("AC", "tok", "BUprimary", "https://cb", ops);
    const r = await gw.registerBrand({ profileSid: "BUxxx", kind: "standard" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("external_service");
    if (!r.ok && r.error.kind === "external_service") expect(r.error.retryable).toBe(false);
  });

  it("fetchStatus threads messagingServiceSid through to fetchCampaignStatus (the campaign resource is nested under the messaging service)", async () => {
    const ops = okOps();
    const gw = new TwilioA2pGateway("AC", "tok", "BUprimary", "https://cb", ops);
    const r = await gw.fetchStatus({
      profileSid: "BUxxx",
      brandSid: "BNxxx",
      campaignSid: "QExxx",
      messagingServiceSid: "MGxxx",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.campaign).toBe("approved");
    expect(ops.fetchCampaignStatus).toHaveBeenCalledWith({ messagingServiceSid: "MGxxx", campaignSid: "QExxx" });
  });

  it("fetchStatus resolves campaign as unknown (and skips the call) when messagingServiceSid is missing", async () => {
    const ops = okOps();
    const gw = new TwilioA2pGateway("AC", "tok", "BUprimary", "https://cb", ops);
    const r = await gw.fetchStatus({
      profileSid: null,
      brandSid: null,
      campaignSid: "QExxx",
      messagingServiceSid: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.campaign).toBe("unknown");
    expect(ops.fetchCampaignStatus).not.toHaveBeenCalled();
  });
});
