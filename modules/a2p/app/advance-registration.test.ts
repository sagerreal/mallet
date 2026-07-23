import { describe, it, expect, vi } from "vitest";
import { AdvanceA2pRegistrationUseCase } from "./advance-registration";
import { A2pRegistration, type BusinessInfo } from "../domain/registration";
import type { RegistrationRepository } from "../domain/registration-repository";
import type { A2pGateway } from "../domain/a2p-gateway";
import { ok, err } from "@mallet/shared/types";

const info = { legalName: "Summit Plumbing", ein: "12-3456789", addressStreet: "x", addressCity: "x", addressRegion: "CA", addressPostal: "94566", industry: "CONSTRUCTION", websiteUrl: "https://s.example", contactFirstName: "S", contactLastName: "R", contactEmail: "s@s.example", contactPhone: "+19255550100" } as BusinessInfo;

function memRepo(seed: A2pRegistration | null = null) {
  let reg: A2pRegistration | null = seed;
  const repo: RegistrationRepository = { get: async () => reg, save: async (r) => { reg = r; } };
  const runner = async <T>(fn: (r: RegistrationRepository) => Promise<T>) => fn(repo);
  return { repo, runner, current: () => reg };
}

// A registration that has completed every prior step (Task 7) and is awaiting async approval.
function numberPendingRegistration(overrides: Partial<Parameters<typeof A2pRegistration.create>[0]> = {}): A2pRegistration {
  const created = A2pRegistration.create({
    orgId: "o1",
    status: "number_pending",
    secondaryProfileSid: "BUx",
    brandSid: "BNx",
    messagingServiceSid: "MGx",
    campaignSid: "QEx",
    phoneNumberSid: "PNx",
    businessInfo: info,
    otpVerified: true,
    failureReason: null,
    ...overrides,
  });
  if (!created.ok) throw new Error("test setup: registration should be valid");
  return created.value;
}

const gateway = (over: Partial<A2pGateway> = {}): A2pGateway => ({
  createSecondaryProfile: vi.fn(),
  registerBrand: vi.fn(),
  createMessagingService: vi.fn(),
  registerCampaign: vi.fn(),
  attachNumber: vi.fn(),
  fetchStatus: vi.fn(async () => ok({ profile: "pending", brand: "pending", campaign: "pending" } as const)),
  ...over,
}) as A2pGateway;

describe("AdvanceA2pRegistrationUseCase", () => {
  it("marks active when profile+brand+campaign are all approved and a number is attached", async () => {
    const { runner, current } = memRepo(numberPendingRegistration());
    const gw = gateway({
      fetchStatus: vi.fn(async () => ok({ profile: "approved", brand: "approved", campaign: "approved" } as const)),
    });
    const uc = new AdvanceA2pRegistrationUseCase(gw, runner, { now: () => new Date() });

    const r = await uc.exec({ orgId: "o1" });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("active");
    expect(current()?.props.status).toBe("active");
    expect(gw.fetchStatus).toHaveBeenCalledWith({
      profileSid: "BUx",
      brandSid: "BNx",
      campaignSid: "QEx",
      messagingServiceSid: "MGx",
    });
  });

  it("marks failed when any of the three is rejected", async () => {
    const { runner, current } = memRepo(numberPendingRegistration());
    const gw = gateway({
      fetchStatus: vi.fn(async () => ok({ profile: "approved", brand: "rejected", campaign: "approved" } as const)),
    });
    const uc = new AdvanceA2pRegistrationUseCase(gw, runner, { now: () => new Date() });

    const r = await uc.exec({ orgId: "o1" });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("failed");
    expect(current()?.props.status).toBe("failed");
    expect(current()?.props.failureReason).toMatch(/brand/i);
  });

  it("leaves the registration pending when nothing is approved or rejected yet", async () => {
    const { runner, current } = memRepo(numberPendingRegistration());
    const gw = gateway(); // default fake: everything still "pending"
    const uc = new AdvanceA2pRegistrationUseCase(gw, runner, { now: () => new Date() });

    const r = await uc.exec({ orgId: "o1" });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("number_pending");
    expect(current()?.props.status).toBe("number_pending");
  });

  it("does not mark active when all three are approved but no phone number is attached yet", async () => {
    const { runner, current } = memRepo(numberPendingRegistration({ phoneNumberSid: null, status: "campaign_pending" }));
    const gw = gateway({
      fetchStatus: vi.fn(async () => ok({ profile: "approved", brand: "approved", campaign: "approved" } as const)),
    });
    const uc = new AdvanceA2pRegistrationUseCase(gw, runner, { now: () => new Date() });

    const r = await uc.exec({ orgId: "o1" });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("campaign_pending");
    expect(current()?.props.status).toBe("campaign_pending");
  });

  it("returns a not_found error when there is no registration to advance", async () => {
    const { runner } = memRepo(null);
    const gw = gateway();
    const uc = new AdvanceA2pRegistrationUseCase(gw, runner, { now: () => new Date() });

    const r = await uc.exec({ orgId: "o1" });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
    expect(gw.fetchStatus).not.toHaveBeenCalled();
  });

  it("propagates a gateway fetchStatus error as-is, without transitioning the registration", async () => {
    const { runner, current } = memRepo(numberPendingRegistration());
    const gatewayError = { kind: "external_service", service: "twilio-a2p", message: "boom", retryable: true } as const;
    const gw = gateway({ fetchStatus: vi.fn(async () => err(gatewayError)) });
    const uc = new AdvanceA2pRegistrationUseCase(gw, runner, { now: () => new Date() });

    const r = await uc.exec({ orgId: "o1" });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toEqual(gatewayError);
    expect(current()?.props.status).toBe("number_pending"); // untouched
  });
});
