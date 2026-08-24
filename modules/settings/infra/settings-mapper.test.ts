import { describe, it, expect } from "vitest";
import { type OrgSettingsRow, toOrgSettings } from "./settings-mapper";
import type { BookingCfg } from "../domain/org-settings";
// Deep-imported (not the @mallet/agent-tasks barrel): a VALUE import of that barrel drags in the
// task router/runner's eager loadConfig() call, which blows up without DB env. ESLint's
// no-restricted-imports boundary is relaxed for test files for exactly this reason.
import { AUTONOMY_LEVELS } from "../../agent-tasks/domain/autonomy";

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
  paymentProvider: 'stripe',
  trade: "plumbing",
  markupBps: 3500,
  taxBps: 0,
  visitScopeMinutes: 30,
  visitRepairMinutes: 90,
  visitInstallMinutes: 240,
  autoRemind: true,
  timesheetClock: true,
  techEditsTimes: false,
  otWeeklyThresholdMinutes: 2400,
  otDailyThresholdMinutes: null,
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
  areaCities: "Pleasanton",
  areaRadiusMi: 25,
  serviceOriginAddress: null,
  originLat: null,
  originLng: null,
  booking: defaultBooking,
  brandTagline: null,
  brandSite: null,
  brandColor: null,
  brandLogoUrl: null,
  brandInitials: null,
  bizAddress: null,
  bizPhone: null,
  bizEmail: null,
  licenseNumber: null,
  docInvoiceFooter: null,
  docInvoicePayInstructions: null,
  docInvoiceReceiptNote: null,
  docChangeOrderAgreement: null,
  stripeConnectedAccountId: null,
  stripeChargesEnabled: false,
  stripePayoutsEnabled: false,
  stripeDetailsSubmitted: false,
  stripeOnboardedAt: null,
  stripeTerminalLocationId: null,
  agentAutonomy: "supervised",
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
});

// ── Tests ───────────────────────────────────────────────────────────────────

// Default org name used in mapper unit tests — the real value comes from orgs.name at
// runtime; the mapper itself is pure and does not fetch it.
const TEST_ORG_NAME = "Acme Plumbing";

describe("toOrgSettings (settings mapper)", () => {
  it("maps a valid DB row to an OrgSettings aggregate", () => {
    const row = baseRow();
    const settings = toOrgSettings(row, TEST_ORG_NAME);
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
    expect(p.measurementEstimating).toBe(false);
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
    const settings = toOrgSettings(row, TEST_ORG_NAME);
    expect(settings.props.trade).toBe("hvac");
  });

  it("clamps visitScopeMinutes below the 15-minute floor", () => {
    const row = baseRow();
    row.visitScopeMinutes = 5; // below floor
    const settings = toOrgSettings(row, TEST_ORG_NAME);
    // OrgSettings.create clamps to 15 — mapper must surface this, not throw
    expect(settings.props.visitScopeMinutes).toBe(15);
  });

  it("throws on a corrupt row (empty trade violates the domain invariant)", () => {
    const row = baseRow();
    row.trade = "";
    expect(() => toOrgSettings(row, TEST_ORG_NAME)).toThrow(/corrupt org_settings/);
  });

  it("maps brandName from the orgName argument, not the row", () => {
    const row = baseRow();
    row.brandTagline = "Licensed & insured";
    row.brandColor = "#9C5B34";
    row.brandInitials = "AP";
    const settings = toOrgSettings(row, "Acme Plumbing");
    const p = settings.props;
    expect(p.brandName).toBe("Acme Plumbing");
    expect(p.brandTagline).toBe("Licensed & insured");
    expect(p.brandColor).toBe("#9C5B34");
    expect(p.brandInitials).toBe("AP");
    expect(p.brandSite).toBeNull();
    expect(p.brandLogoUrl).toBeNull();
  });

  it("round-trips the service-origin fields when present", () => {
    const row = baseRow();
    row.serviceOriginAddress = "123 Main St, Pleasanton, CA 94566";
    row.originLat = 37.6624;
    row.originLng = -121.8747;
    const p = toOrgSettings(row, TEST_ORG_NAME).props;
    expect(p.serviceOriginAddress).toBe("123 Main St, Pleasanton, CA 94566");
    expect(p.originLat).toBe(37.6624);
    expect(p.originLng).toBe(-121.8747);
  });

  it("maps null service-origin fields to null (unset origin)", () => {
    const p = toOrgSettings(baseRow(), TEST_ORG_NAME).props;
    expect(p.serviceOriginAddress).toBeNull();
    expect(p.originLat).toBeNull();
    expect(p.originLng).toBeNull();
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
    const settings = toOrgSettings(row, TEST_ORG_NAME);
    expect(settings.props.booking).toEqual(customBooking);
  });
});

/**
 * WHICH PROCESSOR THE SHOP IS ON. A shop already running Square will not change processors to
 * change software, so this is a per-org fact. The payment ports are already provider-neutral —
 * this value selects the adapter behind them.
 */
describe("toOrgSettings — paymentProvider", () => {
  it("defaults every existing org to stripe", () => {
    expect(toOrgSettings(baseRow(), "Acme").props.paymentProvider).toBe("stripe");
  });

  it("carries square through when that is what the row says", () => {
    expect(toOrgSettings({ ...baseRow(), paymentProvider: "square" }, "Acme").props.paymentProvider).toBe("square");
  });

  // The DB check constraint already guarantees the value. Anything else is corruption, and
  // falling back to stripe can only ever under-claim what a shop connected.
  it("falls back to stripe rather than trusting an unknown value", () => {
    expect(toOrgSettings({ ...baseRow(), paymentProvider: "paypal" }, "Acme").props.paymentProvider).toBe("stripe");
  });
});

/**
 * HOW MUCH THIS SHOP LETS ARTIE DO. Every existing org must default to "supervised" — asking
 * before every action — until an owner explicitly opts up.
 */
describe("toOrgSettings — agentAutonomy", () => {
  it("defaults every existing org to supervised", () => {
    expect(toOrgSettings(baseRow(), "Acme").props.agentAutonomy).toBe("supervised");
  });

  it("carries assisted/autonomous through when that is what the row says", () => {
    expect(toOrgSettings({ ...baseRow(), agentAutonomy: "assisted" }, "Acme").props.agentAutonomy).toBe("assisted");
    expect(toOrgSettings({ ...baseRow(), agentAutonomy: "autonomous" }, "Acme").props.agentAutonomy).toBe("autonomous");
  });

  // The DB check constraint already guarantees the value. Anything else is corruption, and
  // falling back to supervised can only ever under-claim what a shop chose — never grant Artie
  // more autonomy than any human on that shop's team ever selected.
  it("falls back to supervised rather than trusting an unknown value", () => {
    expect(toOrgSettings({ ...baseRow(), agentAutonomy: "yolo" }, "Acme").props.agentAutonomy).toBe("supervised");
  });

  // DRIFT TRIPWIRE: isKnownAgentAutonomy in settings-mapper.ts is a literal copy of
  // AUTONOMY_LEVELS, duplicated because a VALUE import of the @mallet/agent-tasks barrel would
  // pull in the task runner's eager loadConfig() call. `value is AutonomyLevel` is a type
  // predicate, not an exhaustiveness check — TypeScript will not flag it as stale if a level is
  // added to AUTONOMY_LEVELS but missed here, so nothing but a real value driven through the
  // mapper would catch the silent coercion back to "supervised".
  it("carries every AUTONOMY_LEVELS value through unchanged", () => {
    for (const level of AUTONOMY_LEVELS) {
      const settings = toOrgSettings({ ...baseRow(), agentAutonomy: level }, "Acme");
      expect(settings.props.agentAutonomy).toBe(level);
    }
  });
});
