/**
 * lib/store/slices/estimates-slice.test.ts
 *
 * Guards the accept routing (GBB review hardening): updateEstimate with
 * { status: "accepted" } forwards the tier choice — patch.acceptedTier →
 * chosenTier — and converts store dollars to integer cents on the lines
 * payload. Single quotes keep sending no chosenTier.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAccept = vi.fn();

// Type-only import in the slice's dto-mapper dependency; keep the unit hermetic.
vi.mock("@/lib/trpc/client", () => ({ api: {} }));

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      quoting: {
        accept: { mutate: (...a: unknown[]) => mockAccept(...a) },
      },
    },
  },
}));

import { createEstimatesSlice } from "./estimates-slice";
import type { EstimatesSlice } from "./estimates-slice";
import type { Estimate } from "@/lib/store/types";

function makeStore(estimates: Estimate[]) {
  let state: EstimatesSlice;
  const set = (
    partial: Partial<EstimatesSlice> | ((s: EstimatesSlice) => Partial<EstimatesSlice>),
  ) => {
    const next = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...next };
  };
  const get = () => state;
  state = createEstimatesSlice(set as never, get as never, {} as never);
  state = { ...state, estimates };
  return { get };
}

function makeEstimate(overrides: Partial<Estimate> = {}): Estimate {
  return {
    id: "est-1",
    num: "Q-1050",
    leadId: "lead-1",
    title: "Slab leak",
    status: "sent",
    age: 1,
    viewed: false,
    fu: { on: false, stage: 0 },
    lines: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The slice fires .then/.catch on the promise; a pending one keeps the
  // assertion on the REQUEST payload (reconcile/rollback are exercised
  // elsewhere via the integration suite).
  mockAccept.mockReturnValue(new Promise(() => {}));
});

describe("updateEstimate(accepted) — tier choice forwarding", () => {
  it("forwards patch.acceptedTier as chosenTier with the lines in integer cents", () => {
    const { get } = makeStore([makeEstimate({ recommendedTier: "better" })]);

    get().updateEstimate("est-1", {
      status: "accepted",
      acceptedTier: "better",
      lines: [
        { d: "Repair section", q: 1, r: 900 },
        { d: "Camera inspection", q: 1, r: 285.5, opt: false },
      ],
    });

    expect(mockAccept).toHaveBeenCalledWith({
      estimateId: "est-1",
      chosenTier: "better",
      lines: [
        {
          description: "Repair section",
          quantity: 1,
          rateCents: 90_000,
          costCents: 0,
          isOptional: false,
          needsPhoto: false,
        },
        {
          description: "Camera inspection",
          quantity: 1,
          rateCents: 28_550,
          costCents: 0,
          isOptional: false,
          needsPhoto: false,
        },
      ],
    });
  });

  it("sends no chosenTier for a single-format accept (unchanged path)", () => {
    const { get } = makeStore([makeEstimate()]);

    get().updateEstimate("est-1", { status: "accepted" });

    expect(mockAccept).toHaveBeenCalledWith({
      estimateId: "est-1",
      lines: undefined,
      chosenTier: undefined,
    });
  });

  it("applies the optimistic accepted state (status + acceptedTier) immediately", () => {
    const { get } = makeStore([makeEstimate({ recommendedTier: "better" })]);

    get().updateEstimate("est-1", { status: "accepted", acceptedTier: "best" });

    const est = get().estimates.find((e) => e.id === "est-1")!;
    expect(est.status).toBe("accepted");
    expect(est.acceptedTier).toBe("best");
  });
});
