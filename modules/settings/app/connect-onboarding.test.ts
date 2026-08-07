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
    taxBps: 0,
    visitScopeMinutes: 30,
    visitRepairMinutes: 90,
    visitInstallMinutes: 240,
    timesheetClock: true,
    techSeesPrice: true,
    techTexts: true,
    frontDesk: true,
    scopeOn: false,
    autoRemind: true,
    measurementEstimating: false,
    hoursWdOpen: 8,
    hoursWdClose: 17,
    hoursMonOpen: 8,
    hoursMonClose: 17,
    hoursTueOpen: 8,
    hoursTueClose: 17,
    hoursWedOpen: 8,
    hoursWedClose: 17,
    hoursThuOpen: 8,
    hoursThuClose: 17,
    hoursFriOpen: 8,
    hoursFriClose: 17,
    hoursSatOpen: 0,
    hoursSatClose: 0,
    hoursSunOpen: 0,
    hoursSunClose: 0,
    timezone: "America/Los_Angeles",
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
    bizAddress: null,
    bizPhone: null,
    bizEmail: null,
    licenseNumber: null,
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
  const repo = {
    getConfig: vi.fn(async () => current),
    saveConfig: vi.fn(async (s: OrgSettings) => {
      current = s;
    }),
    get current() {
      return current;
    },
  };
  // A tenant runner that "commits" by simply invoking fn against the one in-memory repo. Each call
  // is an independent commit, so a later thrown/failed step cannot undo an earlier run()'s save —
  // mirroring the real two-committed-transactions behaviour.
  const run = <T>(fn: (r: never) => Promise<T>) => fn(repo as never);
  return { repo, run, get current() { return current; } };
}

const gwOk = (over: Partial<ConnectGateway> = {}): ConnectGateway => ({
  createConnectedAccount: vi.fn(async () => ok({ accountId: "acct_new" })),
  createOnboardingLink: vi.fn(async () => ok({ url: "https://connect.stripe.com/x" })),
  retrieveStatus: vi.fn(async () => ok({ chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true })),
  ...over,
});

describe("BeginConnectOnboardingUseCase", () => {
  it("creates an account when the org has none, persists the id, returns the link url", async () => {
    const f = fakeRepo(seedSettings());
    const gw = gwOk();
    const r = await new BeginConnectOnboardingUseCase(gw, f.run, clock).exec({
      orgId: ORG,
      returnUrl: "https://app/return",
      refreshUrl: "https://app/refresh",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.url).toBe("https://connect.stripe.com/x");
    expect(gw.createConnectedAccount).toHaveBeenCalledTimes(1);
    expect(f.current.props.stripeConnectedAccountId).toBe("acct_new");
  });

  it("reuses the existing account id (no second create)", async () => {
    const f = fakeRepo(seedSettings({ stripeConnectedAccountId: "acct_existing" }));
    const gw = gwOk();
    const r = await new BeginConnectOnboardingUseCase(gw, f.run, clock).exec({
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
    const f = fakeRepo(seedSettings());
    const gw = gwOk({
      createConnectedAccount: vi.fn(async () => err(externalService("stripe", "down", true))),
    });
    const r = await new BeginConnectOnboardingUseCase(gw, f.run, clock).exec({
      orgId: ORG,
      returnUrl: "r",
      refreshUrl: "f",
    });
    expect(r.ok).toBe(false);
    expect(gw.createOnboardingLink).not.toHaveBeenCalled();
  });

  // Review HIGH-1 regression: a link failure AFTER the account id was saved must NOT lose the id.
  // Because the id is persisted in its own committed run() before the link mint, the next attempt
  // takes the reuse branch instead of minting a duplicate account.
  it("keeps the persisted account id when the link mint fails (no orphan / no re-mint)", async () => {
    const f = fakeRepo(seedSettings());
    const gw = gwOk({
      createOnboardingLink: vi.fn(async () => err(externalService("stripe", "link down", true))),
    });
    const uc = new BeginConnectOnboardingUseCase(gw, f.run, clock);
    const first = await uc.exec({ orgId: ORG, returnUrl: "r", refreshUrl: "f" });
    expect(first.ok).toBe(false); // link failed
    expect(f.current.props.stripeConnectedAccountId).toBe("acct_new"); // ...but id survived

    // Second attempt (link now works) reuses the stored account — does NOT create a second one.
    const gw2 = gwOk();
    const second = await new BeginConnectOnboardingUseCase(gw2, f.run, clock).exec({
      orgId: ORG,
      returnUrl: "r",
      refreshUrl: "f",
    });
    expect(second.ok).toBe(true);
    expect(gw2.createConnectedAccount).not.toHaveBeenCalled();
    expect(gw2.createOnboardingLink).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "acct_new" }),
    );
  });

  // Review HIGH-2 regression: if a concurrent request already stored an id by the time the save tx
  // runs, do not overwrite it — the re-check inside the persisting run() adopts the existing id.
  it("adopts a concurrently-stored account id rather than overwriting it", async () => {
    const f = fakeRepo(seedSettings());
    // Simulate a concurrent write landing between the initial read and the persist: the gateway
    // create resolves, but another request has already stored acct_other.
    const gw = gwOk({
      createConnectedAccount: vi.fn(async () => {
        // another request commits first
        const s = f.current.patchStripe({ connectedAccountId: "acct_other" }, new Date());
        if (s.ok) await f.run(async (r: never) => (r as { saveConfig: (x: OrgSettings) => Promise<void> }).saveConfig(s.value));
        return ok({ accountId: "acct_mine" });
      }),
    });
    const r = await new BeginConnectOnboardingUseCase(gw, f.run, clock).exec({
      orgId: ORG,
      returnUrl: "r",
      refreshUrl: "f",
    });
    expect(r.ok).toBe(true);
    expect(f.current.props.stripeConnectedAccountId).toBe("acct_other"); // not overwritten
  });
});

describe("RefreshConnectStatusUseCase", () => {
  it("returns not-connected when no account id is stored (no Stripe call)", async () => {
    const f = fakeRepo(seedSettings());
    const gw = gwOk();
    const r = await new RefreshConnectStatusUseCase(gw, f.run, clock).exec({ orgId: ORG });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.hasAccount).toBe(false);
      expect(r.value.detailsSubmitted).toBe(false);
    }
    expect(gw.retrieveStatus).not.toHaveBeenCalled();
  });

  it("persists retrieved status and stamps onboardedAt once charges go live", async () => {
    const f = fakeRepo(seedSettings({ stripeConnectedAccountId: "acct_1" }));
    const gw = gwOk();
    const r = await new RefreshConnectStatusUseCase(gw, f.run, clock).exec({ orgId: ORG });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.hasAccount).toBe(true);
    expect(f.current.props.stripeChargesEnabled).toBe(true);
    expect(f.current.props.stripeOnboardedAt).toEqual(new Date("2026-03-01T00:00:00Z"));
  });

  it("does NOT re-stamp onboardedAt if already set", async () => {
    const earlier = new Date("2026-02-15T00:00:00Z");
    const f = fakeRepo(seedSettings({ stripeConnectedAccountId: "acct_1", stripeOnboardedAt: earlier }));
    const gw = gwOk();
    const r = await new RefreshConnectStatusUseCase(gw, f.run, clock).exec({ orgId: ORG });
    expect(r.ok).toBe(true);
    expect(f.current.props.stripeOnboardedAt).toEqual(earlier);
  });

  it("propagates a retrieve failure", async () => {
    const f = fakeRepo(seedSettings({ stripeConnectedAccountId: "acct_1" }));
    const gw = gwOk({ retrieveStatus: vi.fn(async () => err(externalService("stripe", "down", true))) });
    const r = await new RefreshConnectStatusUseCase(gw, f.run, clock).exec({ orgId: ORG });
    expect(r.ok).toBe(false);
  });
});
