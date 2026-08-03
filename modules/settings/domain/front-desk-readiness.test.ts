import { describe, it, expect } from "vitest";
import { frontDeskReadiness } from "./front-desk-readiness";
import { baseSettingsProps } from "./org-settings.fixtures";
import type { OrgSettingsProps } from "./org-settings";

/**
 * When the front desk may answer a customer.
 *
 * front_desk defaulted to true, so a brand-new shop was handed a phone number pointed at an
 * assistant that knew nobody's hours, no service area and no bookable services. That is the exact
 * state behind "the schedule is full" on every call — and a front desk that knows no services can
 * book nothing, so it must not be the thing answering.
 */

// baseSettingsProps is a FACTORY, not a constant — it takes the overrides.
const props = (over: Partial<OrgSettingsProps> = {}): OrgSettingsProps => {
  const base = baseSettingsProps();
  return baseSettingsProps({
    serviceOriginAddress: "123 Main St, Pleasanton, CA 94566",
    booking: {
      ...base.booking,
      services: [{ name: "Drain clearing", price: 189, lane: "estimate", feeApplies: true, triggers: "" }],
    },
    ...over,
  });
};

describe("frontDeskReadiness", () => {
  it("is ready when hours, a service area and at least one service exist", () => {
    expect(frontDeskReadiness(props()).ready).toBe(true);
  });

  // A shop open zero hours every day is the "schedule is full" bug in its stored form.
  it("is not ready when every day is closed", () => {
    const closed = props({
      hoursMonOpen: 0, hoursMonClose: 0, hoursTueOpen: 0, hoursTueClose: 0,
      hoursWedOpen: 0, hoursWedClose: 0, hoursThuOpen: 0, hoursThuClose: 0,
      hoursFriOpen: 0, hoursFriClose: 0, hoursSatOpen: 0, hoursSatClose: 0,
      hoursSunOpen: 0, hoursSunClose: 0,
    });
    expect(frontDeskReadiness(closed).ready).toBe(false);
    expect(frontDeskReadiness(closed).missing).toContain("hours");
  });

  // Distance is measured from the origin address; without one there is nothing to measure from.
  it("is not ready without a service origin address", () => {
    const r = frontDeskReadiness(props({ serviceOriginAddress: null }));
    expect(r.ready).toBe(false);
    expect(r.missing).toContain("serviceArea");
  });

  it("treats a whitespace-only origin address as absent", () => {
    expect(frontDeskReadiness(props({ serviceOriginAddress: "   " })).missing).toContain("serviceArea");
  });

  // THE GUARD: an assistant that knows no services can book nothing.
  it("is not ready with an empty service list", () => {
    const r = frontDeskReadiness(props({
      booking: { ...baseSettingsProps().booking, services: [] },
    }));
    expect(r.ready).toBe(false);
    expect(r.missing).toContain("services");
  });

  it("reports every gap at once, so the checklist can show all of them", () => {
    const r = frontDeskReadiness(props({
      serviceOriginAddress: null,
      booking: { ...baseSettingsProps().booking, services: [] },
    }));
    expect(r.missing).toEqual(expect.arrayContaining(["serviceArea", "services"]));
  });

  it("counts a single open day as hours — a Saturday-only shop is a real shop", () => {
    const satOnly = props({
      hoursMonOpen: 0, hoursMonClose: 0, hoursTueOpen: 0, hoursTueClose: 0,
      hoursWedOpen: 0, hoursWedClose: 0, hoursThuOpen: 0, hoursThuClose: 0,
      hoursFriOpen: 0, hoursFriClose: 0, hoursSunOpen: 0, hoursSunClose: 0,
      hoursSatOpen: 8, hoursSatClose: 14,
    });
    expect(frontDeskReadiness(satOnly).missing).not.toContain("hours");
  });
});
