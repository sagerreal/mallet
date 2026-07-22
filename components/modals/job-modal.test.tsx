// @vitest-environment jsdom
/**
 * components/modals/job-modal.test.tsx
 *
 * Guards the "quote-created jobs point at their quote" fix:
 *   - PriceSummary shows quote pointer (not "Build the price") when sourceEstimateId is set
 *     and job.lines is empty.
 *   - Without sourceEstimateId, the "Build the price" prompt renders as before.
 *   - estDisplayTotal: correct dollar figure from lines or cachedTotal.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { estDisplayTotal, PriceSummary } from "./job-modal";
import type { Estimate, Job } from "@/lib/store/types";

// ---------------------------------------------------------------------------
// Store mock — only estimates is needed for PriceSummary
// ---------------------------------------------------------------------------

let mockEstimates: Estimate[] = [];

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => null,
  useCloseModal: () => vi.fn(),
  useOpenModal: () => vi.fn(),
  usePushModal: () => vi.fn(),
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ estimates: mockEstimates }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// DurField is not needed for PriceSummary tests; mock it to avoid its own side effects.
vi.mock("./dur-field", () => ({
  DurField: () => null,
}));

// ---------------------------------------------------------------------------
// Minimal fixture builders
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-111",
    leadId: "lead-aaa",
    svc: "service",
    origin: "db",
    title: "Fix boiler",
    addr: "",
    phone: "",
    status: "unscheduled",
    archived: false,
    lines: [],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [],
    ...overrides,
  };
}

function makeEstimate(overrides: Partial<Estimate> = {}): Estimate {
  return {
    id: "est-999",
    num: "Q-0042",
    leadId: "lead-aaa",
    title: "Boiler repair",
    status: "accepted",
    age: 1,
    viewed: true,
    fu: { on: false, stage: 0 },
    lines: [],
    cachedTotal: 350,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// estDisplayTotal — pure helper
// ---------------------------------------------------------------------------

describe("estDisplayTotal", () => {
  it("sums lines when lines are present (q × r)", () => {
    const est = makeEstimate({
      lines: [
        { d: "Labour", q: 2, r: 75 },
        { d: "Parts", q: 1, r: 120 },
      ],
    });
    // 2 × 75 + 1 × 120 = 270
    expect(estDisplayTotal(est)).toBeCloseTo(270);
  });

  it("defaults q to 1 when q is absent", () => {
    const est = makeEstimate({
      lines: [{ d: "Flat rate", r: 200 } as Estimate["lines"][number]],
    });
    expect(estDisplayTotal(est)).toBeCloseTo(200);
  });

  it("falls back to cachedTotal when lines are empty", () => {
    const est = makeEstimate({ lines: [], cachedTotal: 350 });
    expect(estDisplayTotal(est)).toBe(350);
  });

  it("returns null when lines are empty and cachedTotal is absent", () => {
    const est = makeEstimate({ lines: [], cachedTotal: undefined });
    expect(estDisplayTotal(est)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PriceSummary — render tests
// ---------------------------------------------------------------------------

describe("PriceSummary — quote pointer branch", () => {
  it("shows quote pointer text and 'View the quote →' when sourceEstimateId matches a store estimate", () => {
    mockEstimates = [makeEstimate()];
    const job = makeJob({ sourceEstimateId: "est-999", lines: [] });

    render(
      <PriceSummary
        job={job}
        onBuildPrice={vi.fn()}
        onViewQuote={vi.fn()}
      />,
    );

    expect(screen.getByText(/Priced from quote Q-0042/)).toBeTruthy();
    expect(screen.getByText("View the quote →")).toBeTruthy();
    expect(screen.queryByText(/Build the price/)).toBeNull();
  });

  it("shows 'Priced from its quote' (no number) when the estimate is not in the store", () => {
    mockEstimates = []; // estimate absent
    const job = makeJob({ sourceEstimateId: "est-999", lines: [] });

    render(
      <PriceSummary
        job={job}
        onBuildPrice={vi.fn()}
        onViewQuote={vi.fn()}
      />,
    );

    expect(screen.getByText("Priced from its quote")).toBeTruthy();
    expect(screen.queryByText("View the quote →")).toBeNull();
    expect(screen.queryByText(/Build the price/)).toBeNull();
  });

  it("calls onViewQuote with the estimate id when 'View the quote →' is clicked", () => {
    mockEstimates = [makeEstimate()];
    const job = makeJob({ sourceEstimateId: "est-999", lines: [] });
    const onViewQuote = vi.fn();

    render(
      <PriceSummary
        job={job}
        onBuildPrice={vi.fn()}
        onViewQuote={onViewQuote}
      />,
    );

    fireEvent.click(screen.getByText("View the quote →"));
    expect(onViewQuote).toHaveBeenCalledOnce();
    expect(onViewQuote).toHaveBeenCalledWith("est-999");
  });
});

describe("PriceSummary — 'Build the price' branch (no sourceEstimateId)", () => {
  it("shows 'Build the price' when sourceEstimateId is null and lines are empty", () => {
    mockEstimates = [];
    const job = makeJob({ sourceEstimateId: null, lines: [] });
    const onBuildPrice = vi.fn();

    render(
      <PriceSummary
        job={job}
        onBuildPrice={onBuildPrice}
        onViewQuote={vi.fn()}
      />,
    );

    expect(screen.getByText(/Build the price/)).toBeTruthy();
    expect(screen.queryByText(/Priced from/)).toBeNull();
  });

  it("shows 'Build the price' when sourceEstimateId is undefined and lines are empty", () => {
    mockEstimates = [];
    const job = makeJob({ lines: [] }); // sourceEstimateId omitted → undefined

    render(
      <PriceSummary
        job={job}
        onBuildPrice={vi.fn()}
        onViewQuote={vi.fn()}
      />,
    );

    expect(screen.getByText(/Build the price/)).toBeTruthy();
  });

  it("calls onBuildPrice when 'Build the price →' is clicked", () => {
    mockEstimates = [];
    const job = makeJob({ sourceEstimateId: null, lines: [] });
    const onBuildPrice = vi.fn();

    render(
      <PriceSummary
        job={job}
        onBuildPrice={onBuildPrice}
        onViewQuote={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText(/Build the price/));
    expect(onBuildPrice).toHaveBeenCalledOnce();
  });
});
