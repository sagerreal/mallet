import { describe, it, expect } from "vitest";
import { OrgSettings, type OrgSettingsProps } from "./org-settings";
import { asOrgId } from "@mallet/shared/types";

const base = (): OrgSettingsProps => ({
  orgId: asOrgId("00000000-0000-0000-0000-000000000001"),
  trade: "plumbing",
  markupBps: 3500,
  visitScopeMinutes: 30,
  visitRepairMinutes: 90,
  visitInstallMinutes: 240,
  techSeesPrice: true,
  techTexts: true,
  frontDesk: true,
  scopeOn: false,
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
  stripeConnectedAccountId: null,
  stripeChargesEnabled: false,
  stripePayoutsEnabled: false,
  stripeDetailsSubmitted: false,
  stripeOnboardedAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
});

// Helper: unwrap a create() Result or fail loudly.
const build = (props: OrgSettingsProps): OrgSettings => {
  const r = OrgSettings.create(props);
  if (!r.ok) throw new Error(`unexpected invalid settings: ${r.error.message}`);
  return r.value;
};

describe("OrgSettings — stripe connect", () => {
  it("create rejects a connected account id that is not an acct_ id", () => {
    const r = OrgSettings.create({ ...base(), stripeConnectedAccountId: "cus_123" });
    expect(r.ok).toBe(false);
  });

  it("create accepts a null connected account id (not yet onboarded)", () => {
    const r = OrgSettings.create(base());
    expect(r.ok).toBe(true);
  });

  it("patchStripe stores a connected account id and stamps updatedAt", () => {
    const s = build(base());
    const r = s.patchStripe({ connectedAccountId: "acct_123" }, new Date("2026-02-01"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.props.stripeConnectedAccountId).toBe("acct_123");
      expect(r.value.props.updatedAt).toEqual(new Date("2026-02-01"));
    }
  });

  it("patchStripe rejects a non-acct_ id", () => {
    const s = build(base());
    const r = s.patchStripe({ connectedAccountId: "cus_123" }, new Date());
    expect(r.ok).toBe(false);
  });

  it("patchStripe updates status flags and preserves the account id", () => {
    const s = build({ ...base(), stripeConnectedAccountId: "acct_1" });
    const r = s.patchStripe(
      { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true },
      new Date(),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.props.stripeChargesEnabled).toBe(true);
      expect(r.value.props.stripePayoutsEnabled).toBe(true);
      expect(r.value.props.stripeDetailsSubmitted).toBe(true);
      expect(r.value.props.stripeConnectedAccountId).toBe("acct_1");
    }
  });

  it("patch (config) and patchBrand preserve stripe fields untouched", () => {
    const s = build({ ...base(), stripeConnectedAccountId: "acct_1", stripeChargesEnabled: true });
    const r1 = s.patch({ trade: "electrical" }, new Date());
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.value.props.stripeConnectedAccountId).toBe("acct_1");
      expect(r1.value.props.stripeChargesEnabled).toBe(true);
      const r2 = r1.value.patchBrand({ tagline: "fast + fair" }, new Date());
      expect(r2.ok).toBe(true);
      if (r2.ok) expect(r2.value.props.stripeConnectedAccountId).toBe("acct_1");
    }
  });
});
