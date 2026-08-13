import { describe, it, expect } from "vitest";
import { OrgSettings } from "./org-settings";
import { baseSettingsProps } from "./org-settings.fixtures";

/**
 * The overtime rule is the one setting on this record that changes what a person is PAID, so the
 * boundary has to refuse a nonsense rule rather than store it and let My hours quietly report a
 * figure derived from a typo. Two families of nonsense:
 *
 *   - out of range — "overtime past 0 hours" (every hour is overtime) or past 200 hours a week
 *     (nothing ever is). Both are fat fingers, not policies.
 *   - self-contradictory — a weekly threshold shorter than the daily one, which makes the daily
 *     rule unreachable and shows the shop a rule it can never hit.
 *
 * Both patch() and create() are asserted for each case, because patch() is the path the Settings
 * page actually takes and a validation that only guards construction guards nothing in practice.
 */

const at = new Date("2026-08-13T12:00:00Z");

const created = (o: Parameters<typeof baseSettingsProps>[0] = {}) =>
  OrgSettings.create(baseSettingsProps(o));

const base = () => {
  const r = created();
  if (!r.ok) throw new Error("fixture is invalid");
  return r.value;
};

/** Both write paths for one set of overtime fields: construction and the Settings-page patch. */
const bothPaths = (fields: { otWeeklyThresholdMinutes?: number; otDailyThresholdMinutes?: number | null }) => ({
  create: created(fields),
  patch: base().patch(fields, at),
});

describe("overtime thresholds — accepted", () => {
  it("takes federal weekly-40 with no daily rule", () => {
    const { create, patch } = bothPaths({
      otWeeklyThresholdMinutes: 2400,
      otDailyThresholdMinutes: null,
    });
    expect(create.ok).toBe(true);
    expect(patch.ok).toBe(true);
    if (patch.ok) {
      expect(patch.value.props.otWeeklyThresholdMinutes).toBe(2400);
      expect(patch.value.props.otDailyThresholdMinutes).toBeNull();
    }
  });

  it("takes California: past 8h a day or 40h a week", () => {
    const { create, patch } = bothPaths({
      otWeeklyThresholdMinutes: 2400,
      otDailyThresholdMinutes: 480,
    });
    expect(create.ok).toBe(true);
    expect(patch.ok, "a real state's rule was rejected").toBe(true);
    if (patch.ok) expect(patch.value.props.otDailyThresholdMinutes).toBe(480);
  });

  it("takes a daily threshold EQUAL to the weekly one", () => {
    // Degenerate but coherent: a one-day workweek. The rule below is `<`, not `<=`, and this is
    // the case that tells the two apart.
    const { create, patch } = bothPaths({
      otWeeklyThresholdMinutes: 480,
      otDailyThresholdMinutes: 480,
    });
    expect(create.ok).toBe(true);
    expect(patch.ok).toBe(true);
  });
});

describe("overtime thresholds — refused", () => {
  const cases: ReadonlyArray<
    readonly [string, { otWeeklyThresholdMinutes?: number; otDailyThresholdMinutes?: number | null }, string]
  > = [
    ["a weekly threshold of zero", { otWeeklyThresholdMinutes: 0 }, "otWeeklyThresholdMinutes"],
    ["a negative weekly threshold", { otWeeklyThresholdMinutes: -60 }, "otWeeklyThresholdMinutes"],
    ["a weekly threshold longer than a week", { otWeeklyThresholdMinutes: 10081 }, "otWeeklyThresholdMinutes"],
    ["a fractional weekly threshold", { otWeeklyThresholdMinutes: 2400.5 }, "otWeeklyThresholdMinutes"],
    ["a daily threshold of zero", { otDailyThresholdMinutes: 0 }, "otDailyThresholdMinutes"],
    ["a daily threshold longer than a day", { otDailyThresholdMinutes: 1441 }, "otDailyThresholdMinutes"],
    ["a fractional daily threshold", { otDailyThresholdMinutes: 480.25 }, "otDailyThresholdMinutes"],
    [
      "a week shorter than one of its days",
      { otWeeklyThresholdMinutes: 480, otDailyThresholdMinutes: 720 },
      "otWeeklyThresholdMinutes",
    ],
  ];

  for (const [name, fields, field] of cases) {
    it(`refuses ${name}, on both write paths`, () => {
      const { create, patch } = bothPaths(fields);
      expect(create.ok, "create accepted it").toBe(false);
      expect(patch.ok, "patch accepted it").toBe(false);
      if (!patch.ok) expect(patch.error.field).toBe(field);
    });
  }

  it("names the contradiction rather than a range, so the office can act on it", () => {
    const r = base().patch(
      { otWeeklyThresholdMinutes: 480, otDailyThresholdMinutes: 720 },
      at,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/shorter than the daily/i);
  });

  it("leaves the stored rule untouched when a patch is refused", () => {
    // A refused write must not half-apply: the daily field is valid here and the weekly one is not.
    const before = base();
    const r = before.patch({ otWeeklyThresholdMinutes: 0, otDailyThresholdMinutes: 480 }, at);
    expect(r.ok).toBe(false);
    expect(before.props.otWeeklyThresholdMinutes).toBe(2400);
    expect(before.props.otDailyThresholdMinutes).toBeNull();
  });
});
