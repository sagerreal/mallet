/**
 * lib/auth/server-field-toggles.test.ts
 *
 * The layouts' server-side read of the org's field capability flags. Two rules matter and both are
 * here: it must return the org's real answers (that is what removes the first-paint flash on BOTH
 * the scan row and the Text button), and it must FAIL SOFT rather than throw (a settings blip must
 * not 500 the whole office shell — `resolveMe` sets that precedent and this follows it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Principal } from "@mallet/identity";

const fieldToggles = vi.fn();

vi.mock("@/trpc/root", () => ({
  appRouter: { createCaller: () => ({ v1: { settings: { fieldToggles } } }) },
}));
vi.mock("@/trpc/di", () => ({ getAppDeps: () => ({}) }));

const { resolveFieldToggles } = await import("./server-field-toggles");

const principal = { userId: "u1", orgId: "org-1", role: "owner" } as unknown as Principal;

beforeEach(() => {
  fieldToggles.mockReset();
});

describe("resolveFieldToggles — the measurement gate", () => {
  it("returns on for a measuring shop", async () => {
    fieldToggles.mockResolvedValue({ measurementEstimating: true, canText: false });
    await expect(resolveFieldToggles(principal)).resolves.toMatchObject({ measurement: "on" });
  });

  it("returns off for a shop that does not measure — known on the FIRST paint", async () => {
    fieldToggles.mockResolvedValue({ measurementEstimating: false, canText: false });
    // The majority case (plumbing/HVAC/electrical). Answering it here is what stops the composer's
    // Measure card rendering and then vanishing on every cold load.
    await expect(resolveFieldToggles(principal)).resolves.toMatchObject({ measurement: "off" });
  });
});

// The absent→present half of the same defect: `canText` had no server seed at all, so the tech job
// sheet painted Call alone and Text appeared once the client query settled. The DTO carrying it was
// already being fetched right here — the field was simply dropped.
describe("resolveFieldToggles — canText", () => {
  it("seeds yes for a shop with an active A2P campaign", async () => {
    fieldToggles.mockResolvedValue({ measurementEstimating: false, canText: true });
    await expect(resolveFieldToggles(principal)).resolves.toMatchObject({ canText: "yes" });
  });

  it("seeds no for a shop that has not finished carrier registration", async () => {
    fieldToggles.mockResolvedValue({ measurementEstimating: false, canText: false });
    await expect(resolveFieldToggles(principal)).resolves.toMatchObject({ canText: "no" });
  });
});

// The same defect a third time, in the worst place: the overtime rule rode in on this very payload
// and was dropped here too, so My hours computed the FEDERAL figure on first paint and corrected
// itself a beat later. On a California week that is "no overtime" flashing into "8.00 OT" — the
// exact number the rule exists to get right, wrong for a beat.
describe("resolveFieldToggles — the overtime rule", () => {
  it("seeds the shop's own rule, daily threshold included", async () => {
    fieldToggles.mockResolvedValue({
      measurementEstimating: false,
      canText: false,
      overtime: { weeklyThresholdMinutes: 2400, dailyThresholdMinutes: 480 },
    });
    await expect(resolveFieldToggles(principal)).resolves.toMatchObject({
      overtime: { weeklyThresholdMinutes: 2400, dailyThresholdMinutes: 480 },
    });
  });

  it("passes a no-daily-rule shop through as null rather than inventing a threshold", async () => {
    fieldToggles.mockResolvedValue({
      measurementEstimating: false,
      canText: false,
      overtime: { weeklyThresholdMinutes: 2400, dailyThresholdMinutes: null },
    });
    await expect(resolveFieldToggles(principal)).resolves.toMatchObject({
      overtime: { weeklyThresholdMinutes: 2400, dailyThresholdMinutes: null },
    });
  });

  it("carries a non-federal weekly threshold, so a 44h-week shop is not shown a 40h figure", async () => {
    fieldToggles.mockResolvedValue({
      measurementEstimating: false,
      canText: false,
      overtime: { weeklyThresholdMinutes: 2640, dailyThresholdMinutes: null },
    });
    await expect(resolveFieldToggles(principal)).resolves.toMatchObject({
      overtime: { weeklyThresholdMinutes: 2640, dailyThresholdMinutes: null },
    });
  });
});

describe("resolveFieldToggles — hand edits", () => {
  it("seeds yes for a shop that lets technicians correct their own hours", async () => {
    fieldToggles.mockResolvedValue({ measurementEstimating: false, canText: false, techEditsTimes: true });
    await expect(resolveFieldToggles(principal)).resolves.toMatchObject({ techEdits: "yes" });
  });

  it("seeds no for the DEFAULT — most shops keep timesheet changes with the office", async () => {
    fieldToggles.mockResolvedValue({ measurementEstimating: false, canText: false, techEditsTimes: false });
    await expect(resolveFieldToggles(principal)).resolves.toMatchObject({ techEdits: "no" });
  });
});

describe("resolveFieldToggles — failure", () => {
  it("fails soft to unknown on EVERY field when the read throws — it must never 500 the shell", async () => {
    fieldToggles.mockRejectedValue(new Error("settings read exploded"));
    // "unknown" now means what it says: the read failed. The scan surfaces answer that with a
    // visible, disabled control and a stated reason; Text answers it by staying away, because a
    // control the carrier is certain to refuse is worse than no control.
    //
    // Overtime has no third state to fall to, so its seed is simply ABSENT (null) and the hook
    // falls back to the federal rule. That is the one honest default: it is the floor every state
    // is at least as generous as, so a failed read can only ever UNDERSTATE overtime on the
    // technician's own screen — never overstate what the shop is about to pay.
    await expect(resolveFieldToggles(principal)).resolves.toEqual({
      measurement: "unknown",
      canText: "unknown",
      overtime: null,
      // Hand edits fail CLOSED for the sharpest reason of the four: the server refuses the write
      // either way, so a pencil drawn on an unknown answer is a button that can only produce an error.
      techEdits: "unknown",
    });
  });
});
