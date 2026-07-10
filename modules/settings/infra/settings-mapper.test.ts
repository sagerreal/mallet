import { describe, it, expect } from "vitest";
import { type OrgSettingsRow, toOrgSettings } from "./settings-mapper";
import type { BookingCfg } from "../domain/org-settings";

// ── Fixtures ────────────────────────────────────────────────────────────────

const ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ROW_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const defaultBooking: BookingCfg = {
  services: [{ name: "Drain Cleaning", lane: "flat", price: 99, triggers: "clogged drain" }],
  notServices: "septic",
  serviceFee: 89,
  feeCredited: true,
};

const baseRow = (): OrgSettingsRow => ({
  id: ROW_ID,
  orgId: ORG_ID,
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
  booking: defaultBooking,
  brandTagline: null,
  brandSite: null,
  brandColor: null,
  brandLogoUrl: null,
  brandInitials: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("toOrgSettings (settings mapper)", () => {
  it("maps a valid DB row to an OrgSettings aggregate", () => {
    const row = baseRow();
    const settings = toOrgSettings(row);
    const p = settings.props;

    expect(p.orgId).toBe(ORG_ID);
    expect(p.trade).toBe("plumbing");
    expect(p.markupBps).toBe(3500);
    expect(p.visitScopeMinutes).toBe(30);
    expect(p.visitRepairMinutes).toBe(90);
    expect(p.visitInstallMinutes).toBe(240);
    expect(p.techSeesPrice).toBe(true);
    expect(p.techTexts).toBe(true);
    expect(p.frontDesk).toBe(true);
    expect(p.scopeOn).toBe(false);
    expect(p.hoursWdOpen).toBe(8);
    expect(p.hoursWdClose).toBe(17);
    expect(p.areaCities).toBe("Pleasanton");
    expect(p.areaRadiusMi).toBe(25);
    expect(p.booking).toEqual(defaultBooking);
    expect(p.createdAt).toEqual(new Date("2026-07-01T00:00:00Z"));
    expect(p.updatedAt).toEqual(new Date("2026-07-01T00:00:00Z"));
  });

  it("trims leading/trailing whitespace from trade (OrgSettings.create normalisation)", () => {
    const row = baseRow();
    row.trade = "  hvac  ";
    const settings = toOrgSettings(row);
    expect(settings.props.trade).toBe("hvac");
  });

  it("clamps visitScopeMinutes below the 15-minute floor", () => {
    const row = baseRow();
    row.visitScopeMinutes = 5; // below floor
    const settings = toOrgSettings(row);
    // OrgSettings.create clamps to 15 — mapper must surface this, not throw
    expect(settings.props.visitScopeMinutes).toBe(15);
  });

  it("throws on a corrupt row (empty trade violates the domain invariant)", () => {
    const row = baseRow();
    row.trade = "";
    expect(() => toOrgSettings(row)).toThrow(/corrupt org_settings/);
  });

  it("passes the booking jsonb blob through unchanged", () => {
    const row = baseRow();
    const customBooking: BookingCfg = {
      services: [],
      notServices: "HVAC installs",
      serviceFee: 120,
      feeCredited: false,
    };
    row.booking = customBooking;
    const settings = toOrgSettings(row);
    expect(settings.props.booking).toEqual(customBooking);
  });
});
