/**
 * lib/measurement-gate.test.ts
 *
 * The tri-state exists because a boolean placeholdered `false` made "settings have not loaded"
 * and "this shop does not measure" the same value, and every reader hid the app's only native
 * capability on both. These tests pin the two fail DIRECTIONS, which is the whole point: they are
 * deliberately opposite, so a reader that picks the wrong helper is a behaviour change a test
 * catches rather than a silent one.
 */
import { describe, it, expect } from "vitest";
import {
  measurementConfirmed,
  measurementGateFrom,
  measurementSurfacesVisible,
  type MeasurementGate,
} from "./measurement-gate";

const ALL: readonly MeasurementGate[] = ["on", "off", "unknown"];

describe("measurementGateFrom", () => {
  it("maps a settings snapshot's boolean onto a definite answer", () => {
    expect(measurementGateFrom(true)).toBe("on");
    expect(measurementGateFrom(false)).toBe("off");
  });

  it("can never produce unknown — unknown means no snapshot arrived at all", () => {
    expect([measurementGateFrom(true), measurementGateFrom(false)]).not.toContain("unknown");
  });
});

describe("measurementSurfacesVisible — the native affordances, FAIL OPEN", () => {
  it("shows the affordance when the org measures", () => {
    expect(measurementSurfacesVisible("on")).toBe(true);
  });

  /**
   * The guideline-4.2 hole. One 500 from v1.settings.get used to remove the composer's whole
   * Measure card and the field Quote tab's scan row, everywhere, with no reason shown — because
   * an unhydrated boolean was `false`. A read that did not answer must not be the reason the
   * scanner disappears.
   */
  it("shows the affordance when settings have NOT loaded or FAILED", () => {
    expect(measurementSurfacesVisible("unknown")).toBe(true);
  });

  it("hides it only on an answer that actually arrived and said no", () => {
    expect(measurementSurfacesVisible("off")).toBe(false);
  });
});

describe("measurementConfirmed — catalogue edits, FAIL CLOSED", () => {
  it("is true only for a confirmed yes", () => {
    expect(measurementConfirmed("on")).toBe(true);
  });

  it("is false on both no and unknown — a guess must not offer to write measured units", () => {
    expect(measurementConfirmed("off")).toBe(false);
    expect(measurementConfirmed("unknown")).toBe(false);
  });
});

describe("the two predicates disagree exactly once, and that is the design", () => {
  it("differ on unknown and agree on every definite answer", () => {
    const differ = ALL.filter((g) => measurementSurfacesVisible(g) !== measurementConfirmed(g));
    expect(differ).toEqual(["unknown"]);
  });
});
