// @vitest-environment jsdom
/**
 * app/(office)/composer/page.test.tsx
 *
 * Guards the "Build the price" composer entry (?job=<jobId>): on mount the
 * composer calls v1.quoting.buildFromMeasurements, seeds the single-format
 * line table + lead context from the result (cents → dollars at the
 * boundary), and renders gaps + unconfirmedRooms as a quiet inline notice.
 * A failed call shows a NAMED error state, never a blank/broken form. The
 * pre-existing ?lead= boot path is untouched (regression).
 *
 * Sub-components (CustomerSelector/QuoteCard/PricingCard/MessageCard/SendCard)
 * are stubbed to keep this test focused on ComposerPage's own state wiring —
 * their own behavior is covered by their own test files.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComposerState } from "./composer-state";

let searchParamsValue: Record<string, string> = {};
const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => ({ get: (k: string) => searchParamsValue[k] ?? null }),
}));

vi.mock("@/lib/store/app-store", () => ({
  useLeads: () => [],
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      addEstimate: vi.fn(),
      adoptEstimate: vi.fn(),
      moveLeadStage: vi.fn(),
      addLeadNote: vi.fn(),
      services: [],
      laborRates: [],
      updateService: vi.fn(),
    }),
}));

let buildFromMeasurementsState: {
  data: unknown;
  isError: boolean;
} = { data: undefined, isError: false };
const buildFromMeasurementsQuery = vi.fn((_input: unknown, _opts: unknown) => buildFromMeasurementsState);

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { customers: { list: { invalidate: vi.fn() } } } }),
    v1: {
      quoting: {
        buildFromMeasurements: {
          useQuery: (input: unknown, opts: unknown) => buildFromMeasurementsQuery(input, opts),
        },
        draft: { useMutation: () => ({ mutateAsync: vi.fn() }) },
        // ?revise= boot — disabled in these tests (no ?revise param)
        get: { useQuery: () => ({ data: undefined, isError: false }) },
        send: { useMutation: () => ({ mutateAsync: vi.fn() }) },
        archive: { useMutation: () => ({ mutate: vi.fn() }) },
        rules: { create: { useMutation: () => ({ mutate: vi.fn() }) } },
      },
      messaging: { send: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
      notifications: { send: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
      customers: { create: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) } },
      ai: {
        gatherJobContext: { useQuery: () => ({ data: undefined }) },
        draftEstimate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        draftEstimateTiers: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  },
}));

vi.mock("./customer-selector", () => ({
  CustomerSelector: ({ state }: { state: ComposerState }) => (
    <div data-testid="lead-id">{state.leadId ?? ""}</div>
  ),
}));
vi.mock("./quote-card", () => ({
  QuoteCard: ({ state }: { state: ComposerState }) => (
    <>
      <div data-testid="lines">{JSON.stringify(state.lines)}</div>
      <div data-testid="desc">{state.desc}</div>
    </>
  ),
}));
vi.mock("./pricing-card", () => ({ PricingCard: () => null }));
// The panel has its own test file (measured-surfaces-panel.test.tsx); stubbed here
// like the other sections so these tests stay focused on ComposerPage's wiring.
vi.mock("./measured-surfaces-panel", () => ({ MeasuredSurfacesPanel: () => null }));
vi.mock("./message-card", () => ({ MessageCard: () => null }));
vi.mock("./send-card", () => ({ SendCard: () => null }));

import ComposerPage from "./page";

describe("ComposerPage — ?job= boot (Build the price)", () => {
  beforeEach(() => {
    searchParamsValue = {};
    buildFromMeasurementsState = { data: undefined, isError: false };
    buildFromMeasurementsQuery.mockClear();
    routerPush.mockClear();
  });

  it("does not call buildFromMeasurements when there is no ?job=", () => {
    render(<ComposerPage />);
    expect(buildFromMeasurementsQuery).toHaveBeenCalledWith(
      { jobId: "" },
      expect.objectContaining({ enabled: false }),
    );
  });

  it("calls buildFromMeasurements with the job id when ?job= is present", () => {
    searchParamsValue = { job: "job-1" };
    render(<ComposerPage />);
    expect(buildFromMeasurementsQuery).toHaveBeenCalledWith(
      { jobId: "job-1" },
      expect.objectContaining({ enabled: true }),
    );
  });

  it("seeds the line table with cents converted to dollars and sets the lead context", () => {
    searchParamsValue = { job: "job-1" };
    buildFromMeasurementsState = {
      data: {
        leadId: "lead-42",
        seedLines: [
          { description: "Living room — Wall paint", quantity: 562, rateCents: 250, costCents: 90 },
        ],
        gaps: [],
        unconfirmedRooms: [],
      },
      isError: false,
    };
    render(<ComposerPage />);

    expect(screen.getByTestId("lead-id").textContent).toBe("lead-42");
    const lines = JSON.parse(screen.getByTestId("lines").textContent ?? "[]");
    expect(lines).toEqual([{ d: "Living room — Wall paint", q: 562, r: 2.5, c: 0.9 }]);
  });

  it("re-seeds when the ?job= param changes on an already-mounted composer (?job=A -> ?job=B)", () => {
    searchParamsValue = { job: "job-A" };
    buildFromMeasurementsState = {
      data: {
        leadId: "lead-A",
        seedLines: [{ description: "Room A — Wall paint", quantity: 100, rateCents: 200, costCents: 50 }],
        gaps: [],
        unconfirmedRooms: [],
      },
      isError: false,
    };
    const { rerender } = render(<ComposerPage />);
    expect(screen.getByTestId("lead-id").textContent).toBe("lead-A");

    // Same-route param change, composer instance stays mounted — B's seed must still apply
    // (the seed-once guard is keyed on jobId, not on "has this component ever seeded").
    searchParamsValue = { job: "job-B" };
    buildFromMeasurementsState = {
      data: {
        leadId: "lead-B",
        seedLines: [{ description: "Room B — Ceiling paint", quantity: 200, rateCents: 300, costCents: 60 }],
        gaps: [],
        unconfirmedRooms: [],
      },
      isError: false,
    };
    rerender(<ComposerPage />);

    expect(screen.getByTestId("lead-id").textContent).toBe("lead-B");
    const lines = JSON.parse(screen.getByTestId("lines").textContent ?? "[]");
    expect(lines).toEqual([{ d: "Room B — Ceiling paint", q: 200, r: 3, c: 0.6 }]);
  });

  it("does not re-seed on a re-render for the SAME jobId (StrictMode-safe no-op)", () => {
    searchParamsValue = { job: "job-A" };
    buildFromMeasurementsState = {
      data: {
        leadId: "lead-A",
        seedLines: [{ description: "Room A — Wall paint", quantity: 100, rateCents: 200, costCents: 50 }],
        gaps: [],
        unconfirmedRooms: [],
      },
      isError: false,
    };
    const { rerender } = render(<ComposerPage />);
    expect(screen.getByTestId("lead-id").textContent).toBe("lead-A");

    // Same jobId, a background refetch lands DIFFERENT data — must NOT re-stomp the office's
    // (possibly already-edited) lines/lead.
    buildFromMeasurementsState = {
      data: {
        leadId: "lead-A-should-not-apply",
        seedLines: [{ description: "should not apply", quantity: 1, rateCents: 100, costCents: 10 }],
        gaps: [],
        unconfirmedRooms: [],
      },
      isError: false,
    };
    rerender(<ComposerPage />);

    expect(screen.getByTestId("lead-id").textContent).toBe("lead-A");
    const lines = JSON.parse(screen.getByTestId("lines").textContent ?? "[]");
    expect(lines).toEqual([{ d: "Room A — Wall paint", q: 100, r: 2, c: 0.5 }]);
  });

  it("renders a gap notice with the exact functional copy", () => {
    searchParamsValue = { job: "job-1" };
    buildFromMeasurementsState = {
      data: {
        leadId: "lead-42",
        seedLines: [],
        gaps: [{ kind: "baseboard_lnft", label: "Baseboard" }],
        unconfirmedRooms: [],
      },
      isError: false,
    };
    render(<ComposerPage />);

    expect(screen.getByText("No rate set for Baseboard — add one in the Pricebook.")).toBeTruthy();
  });

  it("renders the unconfirmedRooms notice with the exact functional copy", () => {
    searchParamsValue = { job: "job-1" };
    buildFromMeasurementsState = {
      data: {
        leadId: "lead-42",
        seedLines: [],
        gaps: [],
        unconfirmedRooms: ["Kitchen", "Hallway"],
      },
      isError: false,
    };
    render(<ComposerPage />);

    expect(
      screen.getByText("2 rooms have unconfirmed measurements — confirm them on the job before sending."),
    ).toBeTruthy();
  });

  it("shows a named error state — not a blank form — when buildFromMeasurements fails", () => {
    searchParamsValue = { job: "job-1" };
    buildFromMeasurementsState = { data: undefined, isError: true };
    render(<ComposerPage />);

    expect(
      screen.getByText("Couldn't build the price from this job's measurements — check your connection and try again."),
    ).toBeTruthy();
    // The line table still renders (the default blank line) — not a blank/broken form.
    expect(screen.getByTestId("lines")).toBeTruthy();
  });
});

describe("ComposerPage — ?lead= boot (regression, untouched by ?job=)", () => {
  beforeEach(() => {
    searchParamsValue = {};
    buildFromMeasurementsState = { data: undefined, isError: false };
    buildFromMeasurementsQuery.mockClear();
    routerPush.mockClear();
  });

  it("still seeds leadId from ?lead= when there is no ?job=", () => {
    searchParamsValue = { lead: "lead-99" };
    render(<ComposerPage />);
    expect(screen.getByTestId("lead-id").textContent).toBe("lead-99");
  });

  it("does not call buildFromMeasurements for a ?lead=-only boot", () => {
    searchParamsValue = { lead: "lead-99" };
    render(<ComposerPage />);
    expect(buildFromMeasurementsQuery).toHaveBeenCalledWith(
      { jobId: "" },
      expect.objectContaining({ enabled: false }),
    );
  });

  it("seeds the describe-the-job text from ?desc= alongside ?lead= (new-customer Build-the-price handoff)", () => {
    searchParamsValue = { lead: "lead-99", desc: "swap 50-gal water heater" };
    render(<ComposerPage />);
    expect(screen.getByTestId("lead-id").textContent).toBe("lead-99");
    expect(screen.getByTestId("desc").textContent).toBe("swap 50-gal water heater");
  });

  it("leaves the description empty when there is no ?desc=", () => {
    searchParamsValue = { lead: "lead-99" };
    render(<ComposerPage />);
    expect(screen.getByTestId("desc").textContent).toBe("");
  });
});
