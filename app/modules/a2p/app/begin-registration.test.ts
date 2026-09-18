import { describe, it, expect, vi } from "vitest";
import { BeginA2pRegistrationUseCase } from "./begin-registration";
import { A2pRegistration, type BusinessInfo } from "../domain/registration";
import type { RegistrationRepository } from "../domain/registration-repository";
import type { A2pGateway } from "../domain/a2p-gateway";
import { ok } from "@mallet/shared/types";

const info = { legalName: "Summit Plumbing", ein: "12-3456789", addressStreet: "x", addressCity: "x", addressRegion: "CA", addressPostal: "94566", industry: "CONSTRUCTION", websiteUrl: "https://s.example", contactFirstName: "S", contactLastName: "R", contactEmail: "s@s.example", contactPhone: "+19255550100" } as BusinessInfo;

function memRepo() {
  let reg: A2pRegistration | null = null;
  const repo: RegistrationRepository = { get: async () => reg, save: async (r) => { reg = r; } };
  const runner = async <T>(fn: (r: RegistrationRepository) => Promise<T>) => fn(repo);
  return { repo, runner, current: () => reg };
}

const gateway = (over: Partial<A2pGateway> = {}): A2pGateway => ({
  createSecondaryProfile: vi.fn(async () => ok({ profileSid: "BUx" })),
  registerBrand: vi.fn(async () => ok({ brandSid: "BNx" })),
  createMessagingService: vi.fn(async () => ok({ messagingServiceSid: "MGx" })),
  registerCampaign: vi.fn(async () => ok({ campaignSid: "QEx" })),
  attachNumber: vi.fn(async () => ok(undefined)),
  fetchStatus: vi.fn(async () => ok({ profile: "pending", brand: "pending", campaign: "pending" } as const)),
  ...over,
});

describe("BeginA2pRegistrationUseCase", () => {
  it("persists each SID before the next external call and ends number_pending", async () => {
    const { repo, runner, current } = memRepo();
    const gw = gateway();
    const uc = new BeginA2pRegistrationUseCase(gw, runner, { now: () => new Date() });
    const r = await uc.exec({ orgId: "o1", info, phoneNumberSid: "PNx" });
    expect(r.ok).toBe(true);
    expect(current()?.props.secondaryProfileSid).toBe("BUx");
    expect(current()?.props.campaignSid).toBe("QEx");
    expect(current()?.props.status).toBe("number_pending");
  });

  it("a brand failure persists the profile SID and marks failed (resumable)", async () => {
    const { repo, runner, current } = memRepo();
    const gw = gateway({ registerBrand: vi.fn(async () => ({ ok: false, error: { kind: "external_service" } }) as any) });
    const uc = new BeginA2pRegistrationUseCase(gw, runner, { now: () => new Date() });
    const r = await uc.exec({ orgId: "o1", info, phoneNumberSid: "PNx" });
    expect(r.ok).toBe(false);
    expect(current()?.props.secondaryProfileSid).toBe("BUx"); // durable — not rolled back
    expect(current()?.props.status).toBe("failed");
  });

  it("re-invoking on an already fully-registered org is idempotent — no status regression, no re-calls", async () => {
    const { repo, runner, current } = memRepo();
    const gw = gateway();
    const uc = new BeginA2pRegistrationUseCase(gw, runner, { now: () => new Date() });

    const first = await uc.exec({ orgId: "o1", info, phoneNumberSid: "PNx" });
    expect(first.ok).toBe(true);
    expect(current()?.props.status).toBe("number_pending");

    const second = await uc.exec({ orgId: "o1", info, phoneNumberSid: "PNx" });
    expect(second.ok).toBe(true);
    // Bug this covers: step 1 used to unconditionally call withBusinessInfo, which always sets
    // status="collecting" as a side effect — regressing an already-advanced registration on
    // every re-invocation even though no SID was lost. Must stay at its advanced status.
    expect(current()?.props.status).toBe("number_pending");
    expect(current()?.props.secondaryProfileSid).toBe("BUx");
    expect(current()?.props.brandSid).toBe("BNx");
    expect(current()?.props.campaignSid).toBe("QEx");
    // And the gateway must not be re-invoked for steps whose SIDs are already persisted.
    expect(gw.createSecondaryProfile).toHaveBeenCalledTimes(1);
    expect(gw.registerBrand).toHaveBeenCalledTimes(1);
  });
});
