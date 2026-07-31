import { describe, it, expect } from "vitest";
import { OrgSettings } from "./org-settings";
import { baseSettingsProps } from "./org-settings.fixtures";

/**
 * Per-day business hours must survive a patch.
 *
 * THE BUG. patch() spreads the current props and then merges an explicit list of fields — so any
 * field NOT on that list silently keeps its old value however hard the caller sets it. The list
 * covered the weekday default and Saturday and Sunday; the ten Monday-to-Friday fields were
 * missing. So editing "Friday closes at noon" on the front desk saved without error, reported
 * success, and came back as before — and the voice front desk went on booking Friday afternoons.
 *
 * Every day is asserted, not just the one Owen happened to hit. The reason this survived is that
 * two of the seven days DID work, which makes a spot-check look fine.
 */

const at = new Date("2026-08-01T12:00:00Z");
const base = () => {
  const r = OrgSettings.create(baseSettingsProps());
  if (!r.ok) throw new Error("fixture is invalid");
  return r.value;
};

const DAYS = [
  ["hoursMonOpen", "hoursMonClose"],
  ["hoursTueOpen", "hoursTueClose"],
  ["hoursWedOpen", "hoursWedClose"],
  ["hoursThuOpen", "hoursThuClose"],
  ["hoursFriOpen", "hoursFriClose"],
  ["hoursSatOpen", "hoursSatClose"],
  ["hoursSunOpen", "hoursSunClose"],
] as const;

describe("patching business hours", () => {
  for (const [openKey, closeKey] of DAYS) {
    it(`keeps a change to ${openKey} / ${closeKey}`, () => {
      const r = base().patch({ [openKey]: 7, [closeKey]: 12 }, at);
      expect(r.ok, "the patch was rejected").toBe(true);
      if (!r.ok) return;
      expect(r.value.props[openKey]).toBe(7);
      expect(r.value.props[closeKey]).toBe(12);
    });
  }

  it("leaves the other days alone", () => {
    const before = base();
    const r = before.patch({ hoursFriOpen: 6, hoursFriClose: 11 }, at);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.props.hoursMonOpen).toBe(before.props.hoursMonOpen);
    expect(r.value.props.hoursSatOpen).toBe(before.props.hoursSatOpen);
  });

  // 0/0 is the closed sentinel, and it has to be reachable — a shop that shuts on Monday must be
  // able to say so.
  it("accepts a day being closed", () => {
    const r = base().patch({ hoursMonOpen: 0, hoursMonClose: 0 }, at);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.props.hoursMonOpen).toBe(0);
    expect(r.value.props.hoursMonClose).toBe(0);
  });

  it("still refuses a day that opens after it closes", () => {
    expect(base().patch({ hoursWedOpen: 17, hoursWedClose: 9 }, at).ok).toBe(false);
  });
});
