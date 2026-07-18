import { describe, it, expect } from "vitest";
import { asOrgId, isOk } from "@mallet/shared/types";
import { OrgSettings, type OrgSettingsProps, type BookingCfg } from "./org-settings";

const booking: BookingCfg = {
  services: [{ name: "Drain cleaning", lane: "flat", price: 99, triggers: "clogged" }],
  notServices: "septic",
  serviceFee: 89,
  feeCredited: true,
};

const baseProps = (overrides: Partial<OrgSettingsProps> = {}): OrgSettingsProps => ({
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
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
  areaCities: "Pleasanton",
  areaRadiusMi: 25,
  serviceOriginAddress: null,
  originLat: null,
  originLng: null,
  booking,
  brandName: "Test Business",
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
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const unwrap = (r: ReturnType<typeof OrgSettings.create>): OrgSettings => {
  if (!isOk(r)) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};

describe("OrgSettings.create", () => {
  it("rejects an empty trade", () => {
    const r = OrgSettings.create(baseProps({ trade: "  " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("trade");
  });

  it("rejects a negative markup", () => {
    const r = OrgSettings.create(baseProps({ markupBps: -1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("markupBps");
  });

  it("clamps visit minutes to a 15-minute floor", () => {
    const s = unwrap(OrgSettings.create(baseProps({ visitScopeMinutes: 5 })));
    expect(s.props.visitScopeMinutes).toBe(15);
  });

  it("accepts a valid config", () => {
    const s = unwrap(OrgSettings.create(baseProps()));
    expect(s.props.trade).toBe("plumbing");
    expect(s.props.markupBps).toBe(3500);
    expect(s.props.booking.services).toHaveLength(1);
  });
});

// A day's hours are either the CLOSED sentinel (open===0 && close===0) or a valid forward range
// (open < close). A half-open (open=8, close=0), zero-width (12/12), or inverted (17/9) range reads
// as "closed" to the voice availability math and silently sends every caller to voicemail — so the
// aggregate must REJECT it at the boundary (no silent failure), not persist a broken schedule.
describe("OrgSettings.create — business hours invariant", () => {
  it("rejects weekday hours with close=0 and open>0 (the silent-voicemail bug)", () => {
    const r = OrgSettings.create(baseProps({ hoursWdOpen: 8, hoursWdClose: 0 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("hoursWdClose");
  });

  it("rejects inverted weekday hours (close before open)", () => {
    const r = OrgSettings.create(baseProps({ hoursWdOpen: 17, hoursWdClose: 9 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("hoursWdClose");
  });

  it("rejects zero-width weekday hours (open===close, nonzero)", () => {
    const r = OrgSettings.create(baseProps({ hoursWdOpen: 12, hoursWdClose: 12 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("hoursWdClose");
  });

  it("accepts the closed sentinel (open===0 && close===0)", () => {
    const s = unwrap(OrgSettings.create(baseProps({ hoursWdOpen: 0, hoursWdClose: 0 })));
    expect(s.props.hoursWdClose).toBe(0);
  });

  it("accepts a valid forward weekday range", () => {
    const s = unwrap(OrgSettings.create(baseProps({ hoursWdOpen: 8, hoursWdClose: 17 })));
    expect(s.props.hoursWdClose).toBe(17);
  });

  it("rejects an invalid Saturday range even when weekdays are valid", () => {
    const r = OrgSettings.create(baseProps({ hoursSatOpen: 9, hoursSatClose: 0 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("hoursSatClose");
  });

  it("rejects an invalid Sunday range", () => {
    const r = OrgSettings.create(baseProps({ hoursSunOpen: 10, hoursSunClose: 8 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("hoursSunClose");
  });
});

describe("OrgSettings.patch", () => {
  const now = new Date("2026-07-09T12:00:00Z");

  it("patches scalars and bumps updatedAt; undefined fields are unchanged", () => {
    const s = unwrap(OrgSettings.create(baseProps({ markupBps: 3500, trade: "plumbing" })));
    const r = s.patch({ markupBps: 4000 }, now);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.markupBps).toBe(4000);
      expect(r.value.props.trade).toBe("plumbing");
      expect(r.value.props.updatedAt.toISOString()).toBe(now.toISOString());
    }
  });

  it("replaces the booking blob when provided", () => {
    const s = unwrap(OrgSettings.create(baseProps()));
    const r = s.patch({ booking: { ...booking, serviceFee: 120 } }, now);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.booking.serviceFee).toBe(120);
  });

  it("re-validates: patching markup negative fails", () => {
    const s = unwrap(OrgSettings.create(baseProps()));
    const r = s.patch({ markupBps: -5 }, now);
    expect(isOk(r)).toBe(false);
  });
});

describe("OrgSettings.defaultBooking", () => {
  it("returns a complete BookingCfg with all required fields", () => {
    const cfg = OrgSettings.defaultBooking();
    expect(cfg.services).toBeInstanceOf(Array);
    expect(typeof cfg.notServices).toBe("string");
    expect(typeof cfg.serviceFee).toBe("number");
    expect(typeof cfg.feeCredited).toBe("boolean");
  });
});
