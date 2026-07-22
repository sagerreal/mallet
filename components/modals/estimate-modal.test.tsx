// @vitest-environment jsdom
/**
 * components/modals/estimate-modal.test.tsx
 *
 * Guards the tier-aware office quote modal (GBB review hardening):
 *   - a pre-accept Good/Better/Best estimate renders ONLY the recommended
 *     tier's lines and total (effectiveEstLines) — never the sum of all three
 *     tiers — so the modal matches the pipeline card's figure
 *   - the tier stamp line ("3 options · recommended …") stays
 *   - single-format and resolved (accepted) estimates still show every line
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Estimate, Lead } from "@/lib/store/types";

// ---------------------------------------------------------------------------
// Mocks — store selector state + the tRPC hooks the modal wires
// ---------------------------------------------------------------------------

let mockEstimates: Estimate[] = [];
let mockLeads: Lead[] = [];

const storeState = () => ({
  estimates: mockEstimates,
  leads: mockLeads,
  updateEstimate: vi.fn(),
  deleteEstimate: vi.fn(),
  moveLeadStage: vi.fn(),
  updateLead: vi.fn(),
  adoptEstimate: vi.fn(),
});

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "est", params: { estId: "est-1" } }),
  useCloseModal: () => vi.fn(),
  useOpenModal: () => vi.fn(),
  usePushModal: () => vi.fn(),
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) => selector(storeState()),
}));

const idleMutation = () => ({ mutateAsync: vi.fn(), isPending: false });

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      messaging: { send: { useMutation: () => idleMutation() } },
      notifications: { send: { useMutation: () => idleMutation() } },
      quoting: {
        clearChangeRequest: { useMutation: () => idleMutation() },
        get: { useQuery: () => ({ data: undefined, isError: false, error: null }) },
      },
    },
  },
}));

import { EstimateModalContent } from "./estimate-modal";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
    pricing: { disc: 0, dep: 0, tax: 0 },
    ...overrides,
  };
}

const GBB_LINES = [
  { d: "Patch leak", q: 1, r: 350, tier: "good" as const },
  { d: "Repair section", q: 1, r: 900, tier: "better" as const },
  { d: "Replace run", q: 1, r: 1450, tier: "best" as const },
];

beforeEach(() => {
  mockLeads = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EstimateModalContent — tiered estimate (pre-accept)", () => {
  beforeEach(() => {
    mockEstimates = [makeEstimate({ lines: GBB_LINES, recommendedTier: "better" })];
  });

  it("renders ONLY the recommended tier's lines, not all three tiers", () => {
    render(<EstimateModalContent />);
    expect(screen.getByText("Repair section")).toBeTruthy();
    expect(screen.queryByText("Patch leak")).toBeNull();
    expect(screen.queryByText("Replace run")).toBeNull();
  });

  it("totals the recommended tier — never the cross-tier sum", () => {
    render(<EstimateModalContent />);
    // 350 + 900 + 1450 = $2,700 would be the all-tiers bug.
    expect(screen.queryByText("$2,700")).toBeNull();
    // $900 appears as the rate AND the total — the recommended tier's figure.
    expect(screen.getAllByText("$900").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the tier stamp line", () => {
    render(<EstimateModalContent />);
    expect(screen.getByText("3 options · recommended Better")).toBeTruthy();
  });
});

describe("EstimateModalContent — single-format and resolved estimates", () => {
  it("single-format: every line renders and the total sums them all", () => {
    mockEstimates = [
      makeEstimate({
        lines: [
          { d: "Labor", q: 1, r: 400 },
          { d: "Materials", q: 1, r: 200 },
        ],
      }),
    ];
    render(<EstimateModalContent />);
    expect(screen.getByText("Labor")).toBeTruthy();
    expect(screen.getByText("Materials")).toBeTruthy();
    expect(screen.getByText("$600")).toBeTruthy();
  });

  it("resolved (accepted) tiered estimate: shows the committed line set as-is", () => {
    mockEstimates = [
      makeEstimate({
        status: "accepted",
        recommendedTier: "better",
        acceptedTier: "best",
        // Post-accept the lines are already resolved server-side (tags cleared).
        lines: [{ d: "Replace run", q: 1, r: 1450 }],
      }),
    ];
    render(<EstimateModalContent />);
    expect(screen.getByText("Replace run")).toBeTruthy();
    expect(screen.getAllByText("$1,450").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Accepted: Best")).toBeTruthy();
  });
});
