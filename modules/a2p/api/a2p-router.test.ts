// Hermetic unit test for the a2p router's getStatus procedure — no live DB. Mirrors the
// mcp-server.test.ts / mcp-server hermetic pattern: mock the DB tx + outbox seams that
// trpc/init.ts's org-tx middleware touches, and mock the Drizzle repository so `getStatus`
// exercises the real router → GetA2pStatusUseCase wiring against a controlled fake repo.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import type { Principal } from "@mallet/identity";
import type { Context } from "@/trpc/init";

vi.mock("@mallet/shared/db/tx", () => ({
  withTenant: vi.fn().mockImplementation((_orgId: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({})),
}));
vi.mock("@mallet/shared/outbox", () => ({ OutboxEventBus: class {} }));
vi.mock("../infra/drizzle-registration-repository", () => ({
  DrizzleRegistrationRepository: vi.fn(),
}));

import { createA2pRouter } from "./a2p-router";
import { DrizzleRegistrationRepository } from "../infra/drizzle-registration-repository";
import { A2pRegistration, type BusinessInfo } from "../domain/registration";

const info: BusinessInfo = {
  legalName: "Summit Plumbing",
  ein: "12-3456789",
  addressStreet: "1 Main St",
  addressCity: "Danville",
  addressRegion: "CA",
  addressPostal: "94526",
  industry: "CONSTRUCTION",
  websiteUrl: "https://summitplumbing.example",
  contactFirstName: "Dana",
  contactLastName: "Reyes",
  contactEmail: "dana@summitplumbing.example",
  contactPhone: "+19255550100",
};

function registrationWithStatus(
  status: Parameters<typeof A2pRegistration.create>[0]["status"],
  failureReason: string | null = null,
): A2pRegistration {
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

// Minimal but AppDeps-complete stub — same shape as settings-router.int.test.ts's ctxFor. Only
// `clock`/`ids` are actually read by getStatus's path; the rest exist to satisfy the Context type.
const ctxFor = (orgId: string): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role: "owner" } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: { authenticate: async () => { throw new Error("unused"); } },
    apiKeyAuthenticator: { authenticate: async () => null },
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null,
    connectGateway: null,
    photoStorageGateway: null,
    llmClient: null,
    tokenVerifier: { verify: async () => null },
    signupStore: { createOrgForUser: async () => { throw new Error("unused"); } },
  },
});

// Mirrors field-copilot-router.unit.test.ts's mockClass helper — vi.mock replaces the class with a
// bare vi.fn(), so `new RealClass(...)` needs a constructor-shaped implementation to return the fake.
function mockClass<T extends abstract new (...a: never[]) => unknown>(
  ctor: T,
  instance: Partial<InstanceType<T>>,
): void {
  vi.mocked(ctor as unknown as new (...a: never[]) => unknown).mockImplementation(function () {
    return instance;
  });
}

function mockRepo(seed: A2pRegistration | null) {
  mockClass(DrizzleRegistrationRepository, { get: async () => seed, save: async () => {} });
}

describe("a2p router — getStatus (hermetic)", () => {
  beforeEach(() => {
    vi.mocked(DrizzleRegistrationRepository).mockClear();
  });

  it("returns the projected A2pStatusView for a seeded active registration", async () => {
    mockRepo(registrationWithStatus("active"));
    const caller = createA2pRouter().createCaller(ctxFor("o1"));

    const view = await caller.getStatus();

    expect(view).toEqual({
      status: "active",
      canText: true,
      needsInput: false,
      failureReason: null,
    });
  });

  it("returns the projected view (with failureReason) for a seeded failed registration", async () => {
    const reason = "Twilio rejected: secondary customer profile";
    mockRepo(registrationWithStatus("failed", reason));
    const caller = createA2pRouter().createCaller(ctxFor("o1"));

    const view = await caller.getStatus();

    expect(view).toEqual({
      status: "failed",
      canText: false,
      needsInput: true,
      failureReason: reason,
    });
  });

  it("returns a not_started view when no registration row exists", async () => {
    mockRepo(null);
    const caller = createA2pRouter().createCaller(ctxFor("o1"));

    const view = await caller.getStatus();

    expect(view).toEqual({
      status: "not_started",
      canText: false,
      needsInput: true,
      failureReason: null,
    });
  });
});
