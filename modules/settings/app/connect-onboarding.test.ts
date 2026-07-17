import { describe, it, expect, vi } from "vitest";
import { BeginConnectOnboardingUseCase, RefreshConnectStatusUseCase } from "./connect-onboarding";
import { OrgSettings, type OrgSettingsProps } from "../domain/org-settings";
import { asOrgId, ok, err, externalService, type Clock } from "@mallet/shared/types";
import type { ConnectGateway } from "../domain/connect-gateway";

const clock: Clock = { now: () => new Date("2026-03-01T00:00:00Z") };
const ORG = "00000000-0000-0000-0000-000000000001";

function seedSettings(over: Partial<OrgSettingsProps> = {}): OrgSettings {
  const props: OrgSettingsProps = {
    orgId: asOrgId(ORG),
    trade: "plumbing",
    markupBps: 3500,
    visitScopeMinutes: 30,
    visitRepairMinutes: 90,
    visitInstallMinutes: 240,
    techSeesPrice: true,
    techTexts: true,
    frontDesk: true,
    scopeOn: false,
    hoursWdOpen: 8,
    hoursWdClose: 17,
    hoursSatOpen: 0,
    hoursSatClose: 0,
    hoursSunOpen: 0,
    hoursSunClose: 0,
    areaCities: "",
    areaRadiusMi: 25,
    serviceOriginAddress: null,
    originLat: null,
    originLng: null,
    booking: OrgSettings.defaultBooking(),
    brandName: "Bob Plumbing",
    brandTagline: null,
    brandSite: null,
    brandColor: null,
    brandLogoUrl: null,
    brandInitials: null,
    stripeConnectedAccountId: null,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    stripeDetailsSubmitted: false,
    stripeOnboardedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...over,
  };
  const r = OrgSettings.create(props);
  if (!r.ok) throw new Error("seed invalid");
  return r.value;
}

// In-memory settings repo: getConfig returns the current aggregate, saveConfig replaces it.
function fakeRepo(initial: OrgSettings) {
  let current = initial;
  return {
    getConfig: vi.fn(async () => current),
    saveConfig: vi.fn(async (s: OrgSettings) => {
      current = s;
    }),
    get current() {
      return current;
    },
  };
}

const gwOk = (over: Partial<ConnectGateway> = {}): ConnectGateway => ({
  createConnectedAccount: vi.fn(async () => ok({ accountId: "acct_new" })),
  createOnboardingLink: vi.fn(async () => ok({ url: "https://connect.stripe.com/x" })),
  retrieveStatus: vi.fn(async () => ok({ chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true })),
  ...over,
});

describe("BeginConnectOnboardingUseCase", () => {
  it("creates an account when the org has none, persists the id, returns the link url", async () => {
    const repo = fakeRepo(seedSettings());
    const gw = gwOk();
    const r = await new BeginConnectOnboardingUseCase(gw, repo as never, clock).exec({
      orgId: ORG,
      returnUrl: "https://app/return",
      refreshUrl: "https://app/refresh",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.url).toBe("https://connect.stripe.com/x");
    expect(gw.createConnectedAccount).toHaveBeenCalledTimes(1);
    expect(repo.current.props.stripeConnectedAccountId).toBe("acct_new");
  });

  it("reuses the existing account id (no second create)", async () => {
    const repo = fakeRepo(seedSettings({ stripeConnectedAccountId: "acct_existing" }));
    const gw = gwOk();
    const r = await new BeginConnectOnboardingUseCase(gw, repo as never, clock).exec({
      orgId: ORG,
      returnUrl: "r",
      refreshUrl: "f",
    });
    expect(r.ok).toBe(true);
    expect(gw.createConnectedAccount).not.toHaveBeenCalled();
    expect(gw.createOnboardingLink).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "acct_existing" }),
    );
  });

  it("propagates a gateway create failure and does NOT mint a link", async () => {
    const repo = fakeRepo(seedSettings());
    const gw = gwOk({
      createConnectedAccount: vi.fn(async () => err(externalService("stripe", "down", true))),
    });
    const r = await new BeginConnectOnboardingUseCase(gw, repo as never, clock).exec({
      orgId: ORG,
      returnUrl: "r",
      refreshUrl: "f",
    });
    expect(r.ok).toBe(false);
    expect(gw.createOnboardingLink).not.toHaveBeenCalled();
  });
});

describe("RefreshConnectStatusUseCase", () => {
  it("returns not-connected when no account id is stored (no Stripe call)", async () => {
    const repo = fakeRepo(seedSettings());
    const gw = gwOk();
    const r = await new RefreshConnectStatusUseCase(gw, repo as never, clock).exec({ orgId: ORG });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.connected).toBe(false);
    expect(gw.retrieveStatus).not.toHaveBeenCalled();
  });

  it("persists retrieved status and stamps onboardedAt once charges go live", async () => {
    const repo = fakeRepo(seedSettings({ stripeConnectedAccountId: "acct_1" }));
    const gw = gwOk();
    const r = await new RefreshConnectStatusUseCase(gw, repo as never, clock).exec({ orgId: ORG });
    expect(r.ok).toBe(true);
    expect(repo.current.props.stripeChargesEnabled).toBe(true);
    expect(repo.current.props.stripeOnboardedAt).toEqual(new Date("2026-03-01T00:00:00Z"));
  });

  it("does NOT re-stamp onboardedAt if already set", async () => {
    const earlier = new Date("2026-02-15T00:00:00Z");
    const repo = fakeRepo(seedSettings({ stripeConnectedAccountId: "acct_1", stripeOnboardedAt: earlier }));
    const gw = gwOk();
    const r = await new RefreshConnectStatusUseCase(gw, repo as never, clock).exec({ orgId: ORG });
    expect(r.ok).toBe(true);
    expect(repo.current.props.stripeOnboardedAt).toEqual(earlier);
  });

  it("propagates a retrieve failure", async () => {
    const repo = fakeRepo(seedSettings({ stripeConnectedAccountId: "acct_1" }));
    const gw = gwOk({ retrieveStatus: vi.fn(async () => err(externalService("stripe", "down", true))) });
    const r = await new RefreshConnectStatusUseCase(gw, repo as never, clock).exec({ orgId: ORG });
    expect(r.ok).toBe(false);
  });
});
