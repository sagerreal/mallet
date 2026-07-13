// @vitest-environment jsdom
/**
 * components/modals/cust-quote-modal.test.tsx
 *
 * Guards the tier-aware "Preview as customer" surface (GBB review hardening):
 *   - a real tiered estimate renders the tier picker from the tier-tagged
 *     lines + tierNames — per-tier totals, never the cross-tier sum
 *   - Approve commits ONE tier: acceptedTier + only that tier's lines
 *     (+ toggled add-ons within it), tier tags cleared — mirroring the public
 *     accept semantics
 *   - single-format estimates keep the flat line-items path
 *   - a tiered estimate without loaded lines shows a functional error instead
 *     of a fake $0 quote
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Brand, Estimate, EstimateLine, Lead } from "@/lib/store/types";

// ---------------------------------------------------------------------------
// Mocks — store (selector + getState for the read-telemetry effect)
// ---------------------------------------------------------------------------

let mockEstimates: Estimate[] = [];
let mockLeads: Lead[] = [];
const updateEstimate = vi.fn();
const declineEstimate = vi.fn();
const moveLeadStage = vi.fn();
const updateLead = vi.fn();

const BRAND: Brand = {
  site: "example.com",
  name: "Beacon Plumbing",
  initials: "BP",
  color: "#123456",
  tagline: "Licensed & insured",
};

const storeState = () => ({
  estimates: mockEstimates,
  leads: mockLeads,
  brand: BRAND,
  updateEstimate,
  declineEstimate,
  moveLeadStage,
  updateLead,
  recordRead: vi.fn(),
  endRead: vi.fn(),
});

vi.mock("@/lib/store/app-store", () => {
  const useAppStore = Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(storeState()),
    { getState: () => storeState() },
  );
  return {
    useActiveModal: () => ({ id: "custQuote", params: { estId: "est-1" } }),
    useAppStore,
  };
});

// The send primitive pulls trpc; the modal only needs its clock stamp.
vi.mock("@/features/home/send", () => ({ clockNow: () => "9:00am" }));

import { CustQuoteModalContent } from "./cust-quote-modal";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GBB_LINES: EstimateLine[] = [
  { d: "Patch leak", q: 1, r: 350, tier: "good" },
  { d: "Repair section", q: 1, r: 900, tier: "better" },
  { d: "Camera inspection", q: 1, r: 285, opt: true, tier: "better" },
  { d: "Replace run", q: 1, r: 1450, tier: "best" },
];

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
    lines: GBB_LINES,
    pricing: { disc: 0, dep: 0, tax: 0 },
    recommendedTier: "better",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLeads = [];
  mockEstimates = [makeEstimate()];
});

// ---------------------------------------------------------------------------
// Tiered path
// ---------------------------------------------------------------------------

describe("CustQuoteModalContent — tiered estimate", () => {
  it("renders one card per tier with per-tier totals — never the cross-tier sum", () => {
    render(<CustQuoteModalContent />);
    // Tier names fall back to Good/Better/Best (no tierNames set); the card's
    // accessible name is "<name> <total>" (+ the recommended stamp).
    expect(screen.getByRole("button", { name: /Good \$350/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /recommended Better \$900/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Best \$1,450/ })).toBeTruthy();
    // Per-tier card totals (fixed lines only — the optional add-on is excluded).
    expect(screen.getByText("$350")).toBeTruthy();
    expect(screen.getByText("$1,450")).toBeTruthy();
    // The all-tiers sum ($2,700 fixed / $2,985 with add-on) never appears.
    expect(screen.queryByText(/\$2,700|\$2,985/)).toBeNull();
  });

  it("defaults to the recommended tier and shows only its lines", () => {
    render(<CustQuoteModalContent />);
    expect(screen.getByText("Repair section")).toBeTruthy();
    expect(screen.queryByText("Patch leak")).toBeNull();
    expect(screen.queryByText("Replace run")).toBeNull();
    expect(screen.getByRole("button", { name: /Approve Better — \$900/ })).toBeTruthy();
  });

  it("uses custom tierNames when set", () => {
    mockEstimates = [
      makeEstimate({ tierNames: { good: "Patch", better: "Repair", best: "Replace" } }),
    ];
    render(<CustQuoteModalContent />);
    expect(screen.getByRole("button", { name: /Approve Repair — \$900/ })).toBeTruthy();
  });

  it("Approve commits ONLY the selected tier: acceptedTier + its lines, tags cleared", () => {
    render(<CustQuoteModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /Best \$1,450/ }));
    fireEvent.click(screen.getByRole("button", { name: /Approve Best — \$1,450/ }));

    expect(updateEstimate).toHaveBeenCalledWith("est-1", {
      status: "accepted",
      acceptedTier: "best",
      lines: [{ d: "Replace run", q: 1, r: 1450 }],
    });
  });

  it("a toggled add-on joins the committed set flipped non-optional; unselected add-ons drop", () => {
    render(<CustQuoteModalContent />);
    fireEvent.click(screen.getByRole("checkbox")); // Camera inspection (+$285)
    fireEvent.click(screen.getByRole("button", { name: /Approve Better — \$1,185/ }));

    expect(updateEstimate).toHaveBeenCalledWith("est-1", {
      status: "accepted",
      acceptedTier: "better",
      lines: [
        { d: "Repair section", q: 1, r: 900 },
        { d: "Camera inspection", q: 1, r: 285, opt: false },
      ],
    });
  });

  it("switching tiers resets the add-on selection — totals never mix tiers", () => {
    render(<CustQuoteModalContent />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: /Approve Better — \$1,185/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Good \$350/ }));
    expect(screen.getByRole("button", { name: /Approve Good — \$350/ })).toBeTruthy();
    // Back to Better: the add-on is unchecked again.
    fireEvent.click(screen.getByRole("button", { name: /Better \$900/ }));
    expect(screen.getByRole("button", { name: /Approve Better — \$900/ })).toBeTruthy();
  });

  it("drops a tier with no fixed lines from the cards", () => {
    mockEstimates = [
      makeEstimate({ lines: GBB_LINES.filter((l) => l.tier !== "best") }),
    ];
    render(<CustQuoteModalContent />);
    expect(screen.queryByRole("button", { name: /Best \$/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Good \$350/ })).toBeTruthy();
  });

  it("tiered estimate with NO loaded lines: functional error, no Approve", () => {
    mockEstimates = [makeEstimate({ lines: [] })];
    render(<CustQuoteModalContent />);
    expect(
      screen.getByText(/Couldn’t load the quote options — close this preview and reopen it from the quote./),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Single-format regression
// ---------------------------------------------------------------------------

describe("CustQuoteModalContent — single-format estimate", () => {
  it("renders the flat line-items path with the summed total", () => {
    mockEstimates = [
      makeEstimate({
        recommendedTier: undefined,
        lines: [
          { d: "Labor", q: 1, r: 400 },
          { d: "Materials", q: 1, r: 200 },
        ],
      }),
    ];
    render(<CustQuoteModalContent />);
    expect(screen.getByText("Labor")).toBeTruthy();
    expect(screen.getByText("Materials")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Approve — \$600/ })).toBeTruthy();
  });

  it("resolved (accepted) tiered estimates show the accepted confirmation", () => {
    mockEstimates = [
      makeEstimate({
        status: "accepted",
        acceptedTier: "better",
        lines: [{ d: "Repair section", q: 1, r: 900 }],
      }),
    ];
    render(<CustQuoteModalContent />);
    expect(screen.getByText(/Approved — thank you!/)).toBeTruthy();
  });
});
