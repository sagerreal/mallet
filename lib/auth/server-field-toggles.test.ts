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

describe("resolveFieldToggles — failure", () => {
  it("fails soft to unknown on BOTH flags when the read throws — it must never 500 the shell", async () => {
    fieldToggles.mockRejectedValue(new Error("settings read exploded"));
    // "unknown" now means what it says: the read failed. The scan surfaces answer that with a
    // visible, disabled control and a stated reason; Text answers it by staying away, because a
    // control the carrier is certain to refuse is worse than no control.
    await expect(resolveFieldToggles(principal)).resolves.toEqual({
      measurement: "unknown",
      canText: "unknown",
    });
  });
});
