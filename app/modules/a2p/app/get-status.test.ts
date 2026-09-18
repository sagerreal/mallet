import { describe, it, expect } from "vitest";
import { GetA2pStatusUseCase } from "./get-status";
import { A2pRegistration, type BusinessInfo } from "../domain/registration";
import type { RegistrationRepository } from "../domain/registration-repository";
import type { A2pTenantRunner } from "./begin-registration";

const info = { legalName: "Summit Plumbing", ein: "12-3456789", addressStreet: "x", addressCity: "x", addressRegion: "CA", addressPostal: "94566", industry: "CONSTRUCTION", websiteUrl: "https://s.example", contactFirstName: "S", contactLastName: "R", contactEmail: "s@s.example", contactPhone: "+19255550100" } as BusinessInfo;

function memRepo(seed: A2pRegistration | null = null) {
  let reg: A2pRegistration | null = seed;
  const repo: RegistrationRepository = { get: async () => reg, save: async (r) => { reg = r; } };
  const runner: A2pTenantRunner = async <T,>(fn: (r: RegistrationRepository) => Promise<T>) => fn(repo);
  return { repo, runner };
}

function registrationWithStatus(status: Parameters<typeof A2pRegistration.create>[0]["status"], failureReason: string | null = null): A2pRegistration {
  const created = A2pRegistration.create({
    orgId: "o1",
    status,
    secondaryProfileSid: "BUx",
    brandSid: "BNx",
    messagingServiceSid: "MGx",
    campaignSid: "QEx",
    phoneNumberSid: "PNx",
    businessInfo: info,
    otpVerified: true,
    failureReason,
  });
  if (!created.ok) throw new Error("test setup: registration should be valid");
  return created.value;
}

describe("GetA2pStatusUseCase", () => {
  it("returns not_started view when no registration row exists", async () => {
    const { runner } = memRepo(null);
    const uc = new GetA2pStatusUseCase(runner);

    const view = await uc.exec("o1");

    expect(view.status).toBe("not_started");
    expect(view.canText).toBe(false);
    expect(view.needsInput).toBe(true);
    expect(view.failureReason).toBe(null);
  });

  it("returns active view when registration is active", async () => {
    const { runner } = memRepo(registrationWithStatus("active"));
    const uc = new GetA2pStatusUseCase(runner);

    const view = await uc.exec("o1");

    expect(view.status).toBe("active");
    expect(view.canText).toBe(true);
    expect(view.needsInput).toBe(false);
    expect(view.failureReason).toBe(null);
  });

  it("returns failed view with failure reason when registration is failed", async () => {
    const reason = "Twilio rejected: secondary customer profile";
    const { runner } = memRepo(registrationWithStatus("failed", reason));
    const uc = new GetA2pStatusUseCase(runner);

    const view = await uc.exec("o1");

    expect(view.status).toBe("failed");
    expect(view.canText).toBe(false);
    expect(view.needsInput).toBe(true);
    expect(view.failureReason).toBe(reason);
  });

  it("returns collecting view (not needsInput) when registration is in progress", async () => {
    const { runner } = memRepo(registrationWithStatus("collecting"));
    const uc = new GetA2pStatusUseCase(runner);

    const view = await uc.exec("o1");

    expect(view.status).toBe("collecting");
    expect(view.canText).toBe(false);
    expect(view.needsInput).toBe(false);
    expect(view.failureReason).toBe(null);
  });

  it("returns profile_pending view when awaiting profile approval", async () => {
    const { runner } = memRepo(registrationWithStatus("profile_pending"));
    const uc = new GetA2pStatusUseCase(runner);

    const view = await uc.exec("o1");

    expect(view.status).toBe("profile_pending");
    expect(view.canText).toBe(false);
    expect(view.needsInput).toBe(false);
    expect(view.failureReason).toBe(null);
  });
});
