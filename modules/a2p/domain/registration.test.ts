import { describe, it, expect } from "vitest";
import { A2pRegistration, brandKind, type BusinessInfo } from "./registration";

const info: BusinessInfo = {
  legalName: "Summit Plumbing LLC", ein: "12-3456789",
  addressStreet: "200 Ray St", addressCity: "Pleasanton", addressRegion: "CA",
  addressPostal: "94566", industry: "CONSTRUCTION", websiteUrl: "https://summit.example",
  contactFirstName: "Sam", contactLastName: "Rivera", contactEmail: "sam@summit.example",
  contactPhone: "+19255550100",
};

describe("A2pRegistration state machine", () => {
  it("starts not_started and advances profile→brand→campaign→number→active", () => {
    const r0 = A2pRegistration.create({ orgId: "o1", status: "not_started", secondaryProfileSid: null, brandSid: null, messagingServiceSid: null, campaignSid: null, phoneNumberSid: null, businessInfo: null, otpVerified: false, failureReason: null });
    expect(r0.ok).toBe(true);
    if (!r0.ok) throw new Error();
    const r1 = r0.value.withBusinessInfo(info);       // → collecting
    expect(r1.props.status).toBe("collecting");
    const r2 = r1.withProfile("BUxxx");                // → profile_pending
    expect(r2.props.status).toBe("profile_pending");
    expect(r2.props.secondaryProfileSid).toBe("BUxxx");
    const r3 = r2.withBrand("BNxxx").withMessagingService("MGxxx"); // → brand_pending
    expect(r3.props.status).toBe("brand_pending");
    const r4 = r3.withCampaign("QExxx");               // → campaign_pending
    expect(r4.props.status).toBe("campaign_pending");
    const r5 = r4.withNumber("PNxxx").markActive();    // → active
    expect(r5.props.status).toBe("active");
    // immutability: the original is untouched
    expect(r0.value.props.status).toBe("not_started");
  });

  it("brandKind is sole_proprietor without an EIN, standard with one", () => {
    expect(brandKind(info)).toBe("standard");
    expect(brandKind({ ...info, ein: null })).toBe("sole_proprietor");
  });

  it("markFailed records a reason and status failed from any state", () => {
    const r = A2pRegistration.create({ orgId: "o1", status: "brand_pending", secondaryProfileSid: "BUx", brandSid: "BNx", messagingServiceSid: "MGx", campaignSid: null, phoneNumberSid: null, businessInfo: info, otpVerified: true, failureReason: null });
    if (!r.ok) throw new Error();
    const f = r.value.markFailed("brand rejected by TCR");
    expect(f.props.status).toBe("failed");
    expect(f.props.failureReason).toBe("brand rejected by TCR");
  });
});
