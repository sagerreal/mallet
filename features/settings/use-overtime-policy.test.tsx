// @vitest-environment jsdom
/**
 * The overtime rule My hours computes from. Three contracts, and the middle one is the reason this
 * hook is not a plain query:
 *
 *   - the LIVE query wins once it has answered, so a rule changed in Settings lands without a
 *     reload;
 *   - the SERVER SEED covers every paint before that. Without it a California technician's 4x10
 *     week first painted as no overtime and then became 8.00 OT — the exact figure the rule exists
 *     to get right, wrong for a beat, on the screen that tells him what he earned;
 *   - with neither, the FEDERAL floor. Not "unknown": weekly-40 is the column default and the rule
 *     where no state adds one, so the fallback can only ever understate overtime on this screen,
 *     never overstate what the shop is about to pay.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  OvertimePolicyProvider,
  useOvertimePolicy,
  FEDERAL_OVERTIME_POLICY,
} from "./use-overtime-policy";
import type { OvertimePolicySeed } from "@/lib/field-toggles-seed";

const fieldTogglesQuery = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { settings: { fieldToggles: { useQuery: () => fieldTogglesQuery() } } } },
}));

const CALIFORNIA: OvertimePolicySeed = { weeklyThresholdMinutes: 2400, dailyThresholdMinutes: 480 };
const SIX_DAY_WEEK: OvertimePolicySeed = { weeklyThresholdMinutes: 2880, dailyThresholdMinutes: null };

const seeded = (seed: OvertimePolicySeed | null) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <OvertimePolicyProvider seed={seed}>{children}</OvertimePolicyProvider>;
  };

const policy = (seed: OvertimePolicySeed | null) =>
  renderHook(() => useOvertimePolicy(), { wrapper: seeded(seed) }).result.current;

describe("useOvertimePolicy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("takes the seed on the FIRST render, before any query has answered", () => {
    fieldTogglesQuery.mockReturnValue({ data: undefined });
    // The whole point: this is the value the first HTML carries. A daily threshold here and a
    // federal one a beat later is the flash.
    expect(policy(CALIFORNIA)).toEqual(CALIFORNIA);
  });

  it("takes the live query once it lands, so a policy changed in Settings follows without a reload", () => {
    fieldTogglesQuery.mockReturnValue({ data: { overtime: SIX_DAY_WEEK } });
    expect(policy(CALIFORNIA)).toEqual(SIX_DAY_WEEK);
  });

  it("falls to the federal floor with no seed and no answer", () => {
    fieldTogglesQuery.mockReturnValue({ data: undefined });
    expect(policy(null)).toEqual(FEDERAL_OVERTIME_POLICY);
  });

  it("falls to the federal floor when the server read failed — never a blank, never an invented rule", () => {
    fieldTogglesQuery.mockReturnValue({ data: undefined, isError: true });
    const p = policy(null);
    expect(p.weeklyThresholdMinutes).toBe(2400);
    expect(p.dailyThresholdMinutes, "a daily rule nobody configured").toBeNull();
  });

  it("works with no provider in the tree at all", () => {
    // An office surface or a bare render: no field layout, so no seed. Still a usable rule.
    fieldTogglesQuery.mockReturnValue({ data: undefined });
    expect(renderHook(() => useOvertimePolicy()).result.current).toEqual(FEDERAL_OVERTIME_POLICY);
  });

  it("keeps a seeded DAILY rule when the query answers without one — a null threshold is an answer", () => {
    // The trap in `??`: a live shop that genuinely has no daily rule must clear a stale seeded one,
    // rather than the seed leaking through because null looked like "no answer". The query object
    // is present, so its overtime value is authoritative even where a field inside it is null.
    fieldTogglesQuery.mockReturnValue({ data: { overtime: SIX_DAY_WEEK } });
    expect(policy(CALIFORNIA).dailyThresholdMinutes).toBeNull();
  });
});
