/**
 * lib/auth/server-measurement-gate.test.ts
 *
 * The layouts' server-side read of the measurement gate. Two rules matter and both are here:
 * it must return the org's real answer (that is what removes the first-paint flash), and it must
 * FAIL SOFT to `"unknown"` rather than throw (a settings blip must not 500 the whole office shell
 * — `resolveMe` sets that precedent and this follows it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Principal } from "@mallet/identity";

const fieldToggles = vi.fn();

vi.mock("@/trpc/root", () => ({
  appRouter: { createCaller: () => ({ v1: { settings: { fieldToggles } } }) },
}));
vi.mock("@/trpc/di", () => ({ getAppDeps: () => ({}) }));

const { resolveMeasurementGate } = await import("./server-measurement-gate");

const principal = { userId: "u1", orgId: "org-1", role: "owner" } as unknown as Principal;

beforeEach(() => {
  fieldToggles.mockReset();
});

describe("resolveMeasurementGate", () => {
  it("returns on for a measuring shop", async () => {
    fieldToggles.mockResolvedValue({ measurementEstimating: true });
    await expect(resolveMeasurementGate(principal)).resolves.toBe("on");
  });

  it("returns off for a shop that does not measure — known on the FIRST paint", async () => {
    fieldToggles.mockResolvedValue({ measurementEstimating: false });
    // The majority case (plumbing/HVAC/electrical). Answering it here is what stops the composer's
    // Measure card rendering and then vanishing on every cold load.
    await expect(resolveMeasurementGate(principal)).resolves.toBe("off");
  });

  it("fails soft to unknown when the read throws — it must never 500 the shell", async () => {
    fieldToggles.mockRejectedValue(new Error("settings read exploded"));
    // "unknown" now means what it says: the read failed. The surfaces answer that with a visible,
    // disabled control and a stated reason — not with silence, and not with a live scanner.
    await expect(resolveMeasurementGate(principal)).resolves.toBe("unknown");
  });
});
