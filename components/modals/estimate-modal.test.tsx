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

let mockJobs: unknown[] = [];
let mockEstimates: Estimate[] = [];
let mockLeads: Lead[] = [];

const storeState = () => ({
  estimates: mockEstimates,
      jobs: mockJobs,
  leads: mockLeads,
  updateEstimate: vi.fn(),
  deleteEstimate: vi.fn(),
  moveLeadStage: vi.fn(),
  updateLead: vi.fn(),
  adoptEstimate: vi.fn(),
});

const routerPush = vi.fn();
const pushModal = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "est", params: { estId: "est-1" } }),
  useCloseModal: () => vi.fn(),
  useOpenModal: () => vi.fn(),
  usePushModal: () => pushModal,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) => selector(storeState()),
}));

const idleMutation = () => ({ mutateAsync: vi.fn(), isPending: false });
let mockFullQuery: { data: unknown; isError: boolean; error: null; isLoading?: boolean } = {
  data: undefined,
  isError: false,
  error: null,
  isLoading: false,
};

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      messaging: { send: { useMutation: () => idleMutation() } },
      notifications: { send: { useMutation: () => idleMutation() } },
      quoting: {
        clearChangeRequest: { useMutation: () => idleMutation() },
        get: { useQuery: () => mockFullQuery },
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


/**
 * THE OPENING BEAT. List hydration carries no lines, so a quote opened from the ledger used to
 * render instantly as an empty table with a $0 total, then reflow wholesale when the full record
 * landed — Owen's "glitch". While the modal's own fetch is in flight, it shows the loading state.
 */
describe("EstimateModalContent — the header-only copy waits for the record", () => {
  beforeEach(() => {
    mockLeads = [{ id: "lead-1", name: "Dana" } as unknown as Lead];
    mockJobs = [];
  });

  it("shows loading — never an empty $0 sheet — while the full record is fetching", () => {
    mockEstimates = [
      { id: "est-1", leadId: "lead-1", num: "EST-1040", title: "flat rate test 09",
        status: "accepted", age: 0, lines: [] } as unknown as Estimate,
    ];
    mockFullQuery = { data: undefined, isError: false, error: null, isLoading: true };
    render(<EstimateModalContent />);

    expect(screen.queryByText(/\$0/)).toBeNull();
    expect(screen.queryByText("Total")).toBeNull();
  });
});

/**
 * THE TERMINAL STATES HAD NO FOOT — a won quote offered nothing but a quiet red Delete, which
 * read as "just a viewing modal" (Owen). A won quote's next move is the JOB it became; a lost
 * one's is another attempt.
 */
describe("EstimateModalContent — terminal-state feet", () => {
  beforeEach(() => {
    mockLeads = [{ id: "lead-1", name: "Dana" } as unknown as Lead];
    mockFullQuery = { data: undefined, isError: false, error: null, isLoading: false };
    pushModal.mockClear();
    routerPush.mockClear();
  });

  const won = () =>
    ({ id: "est-1", leadId: "lead-1", num: "EST-1040", title: "flat rate test 09",
       status: "accepted", age: 0,
       lines: [{ d: "Annual plumbing inspection", q: 1, r: 185 }] }) as unknown as Estimate;

  it("a WON quote opens the job it became", () => {
    mockEstimates = [won()];
    mockJobs = [{ id: "job-9", sourceEstimateId: "est-1", archived: false }];
    render(<EstimateModalContent />);

    screen.getByText("Open the job →").click();
    expect(pushModal).toHaveBeenCalledWith("job", { jobId: "job-9" });
  });

  it("no job in the store → no button — a primary that opens nothing is worse than none", () => {
    mockEstimates = [won()];
    mockJobs = [];
    render(<EstimateModalContent />);
    expect(screen.queryByText("Open the job →")).toBeNull();
  });

  it("a LOST quote offers another attempt through the composer's revise path", () => {
    mockEstimates = [{ ...won(), status: "declined" } as unknown as Estimate];
    render(<EstimateModalContent />);

    screen.getByText("Revise & try again").click();
    expect(routerPush).toHaveBeenCalledWith("/composer?revise=est-1");
  });
});
