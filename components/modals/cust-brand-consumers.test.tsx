// @vitest-environment jsdom
/**
 * Regression guard: customer-facing surfaces (cust-quote-modal, cust-invoice-modal)
 * must render the HYDRATED store brand — not a hardcoded placeholder.
 *
 * The consumers already read useAppStore((s) => s.brand). This test codifies that
 * invariant so a future refactor that reintroduces a constant is caught immediately.
 *
 * Approach: mock the store with a distinctive HYDRATED brand and assert the brand
 * name appears in the rendered output. A hardcoded "Rivera Plumbing" (prototype
 * sample) would fail this test. No runtime surface is added.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// A brand that is unmistakably NOT the prototype sample.
const HYDRATED = {
  name: "Hydrated HVAC",
  initials: "HH",
  color: "#123456",
  site: "hydrated.example",
  tagline: "From the DB",
};

// ---- vi.mock must precede imports that consume the store ----
// The factory is hoisted by vitest; it must not reference outer variables.
// We build self-contained state objects inside the factory.

vi.mock("@/lib/store/app-store", () => {
  const HYDRATED_BRAND = {
    name: "Hydrated HVAC",
    initials: "HH",
    color: "#123456",
    site: "hydrated.example",
    tagline: "From the DB",
  };

  const quoteState = {
    brand: HYDRATED_BRAND,
    estimates: [
      {
        id: "e1",
        num: "Q-1",
        leadId: "l1",
        title: "Quote",
        status: "sent",
        age: 0,
        viewed: true,
        fu: { on: false, stage: 0 },
        lines: [],
        reads: [],
        archived: false,
        trash: false,
      },
    ],
    leads: [{ id: "l1", name: "Cust", job: "Repair", source: "web" }],
    invoices: [
      {
        id: "inv1",
        num: "INV-1",
        leadId: "l1",
        jobId: undefined,
        total: 500,
        depPaid: 0,
        payments: [],
        lines: [{ d: "Labor", q: 1, r: 500, opt: false }],
      },
    ],
    jobs: [],
    updateEstimate: () => {},
    declineEstimate: () => {},
    moveLeadStage: () => {},
    updateLead: () => {},
    recordRead: () => {},
    endRead: () => {},
    recordPayment: () => {},
  };

  // useActiveModal is called at the component level — the params determine which
  // estimate/invoice is opened. We alternate between quote and invoice param shapes
  // by using a mutable ref so each test suite can set its own modal params.
  let _activeModal: { id: string; params: Record<string, string> } = {
    id: "custQuote",
    params: { estId: "e1" },
  };

  // Expose a setter via globalThis so test bodies (post-hoist) can change the
  // active modal params before rendering.
  (globalThis as Record<string, unknown>).__setMockActiveModal = (
    m: { id: string; params: Record<string, string> }
  ) => {
    _activeModal = m;
  };

  const useAppStore = Object.assign(
    (sel: (s: typeof quoteState) => unknown) => sel(quoteState),
    { getState: () => quoteState }
  );

  const useActiveModal = () => _activeModal;

  return { useAppStore, useActiveModal };
});

// Import after vi.mock so the mock is in place when the modules resolve.
import { CustQuoteModalContent } from "./cust-quote-modal";
import { CustInvoiceModalContent } from "./cust-invoice-modal";

// Helper — keeps tests readable without repeating the cast.
function setActiveModal(modal: { id: string; params: Record<string, string> }) {
  (
    (globalThis as Record<string, unknown>).__setMockActiveModal as (m: typeof modal) => void
  )(modal);
}

// ---- tests ----

describe("CustQuoteModalContent — renders the hydrated store brand", () => {
  it("shows the store brand name and never the prototype sample", () => {
    // Arrange
    setActiveModal({ id: "custQuote", params: { estId: "e1" } });

    // Act
    render(<CustQuoteModalContent />);

    // Assert — brand.name from the hydrated store appears (in header + body copy);
    // the prototype sample name must not appear anywhere.
    expect(screen.getAllByText(HYDRATED.name).length).toBeGreaterThan(0);
    expect(screen.queryByText("Rivera Plumbing")).toBeNull();
  });
});

describe("CustInvoiceModalContent — renders the hydrated store brand", () => {
  it("shows the store brand name in the header and never the prototype sample", () => {
    // Arrange
    setActiveModal({ id: "custInvoice", params: { invoiceId: "inv1" } });

    // Act
    render(<CustInvoiceModalContent />);

    // Assert — brand.name from the hydrated store appears in header + save-card copy.
    const matches = screen.getAllByText(HYDRATED.name);
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.queryByText("Rivera Plumbing")).toBeNull();
  });
});
