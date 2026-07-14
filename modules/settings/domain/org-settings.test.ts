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
