// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
// PriceSummary reads the store to name the source quote. Note what that means: the
// "View the quote" link only appears when that estimate happens to be LOADED — the same
// one-page ceiling seen elsewhere. It degrades to "Priced from its quote", and "+ More work"
// renders either way, which is why the change-order path does not depend on it.
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { estimates: unknown[] }) => unknown) =>
    sel({ estimates: [{ id: "est-1", num: "EST-1033", cachedTotal: 730, lines: [], archived: false, trash: false }] }),
}));

import { PriceSummary } from "./job-modal";
import type { Job } from "@/lib/store/types";

/**
 * Finding the scope, and adding to it.
 *
 * The line items and the "+ More work" that raises a change order live inside the Price row's
 * accordion. Owen asked TWICE where they were — which is the answer: a row reading "$730" looks
 * like the whole story and gives nobody a reason to open it.
 *
 * Two fixes are asserted here. The row now says how many items are inside, so there is something
 * to open it FOR. And "+ More work" appears on a job priced from its quote — the common case for
 * sold work, and previously the one branch with no way to raise a change order at all.
 */

const job = (over: Partial<Job> = {}): Job =>
  ({
    id: "job-1",
    num: "JOB-2533",
    leadId: "lead-1",
    title: "Slab leak",
    status: "scheduled",
    visits: [],
    lines: [],
    addons: [],
    archived: false,
    ...over,
  }) as Job;

const handlers = () => ({
  onBuildPrice: vi.fn(),
  onViewQuote: vi.fn(),
  onAddWork: vi.fn(),
});

describe("a job priced from its quote", () => {
  it("offers + More work — extra work is found on any job, not only a priced one", () => {
    const h = handlers();
    render(<PriceSummary job={job({ sourceEstimateId: "est-1" })} {...h} />);
    const btn = screen.getByText("+ More work");
    expect(btn).toBeTruthy();
    btn.click();
    // The handler opens the on-glass price-and-sign surface for THIS job. It used to navigate to
    // a blank full quote builder to add one line, which is the wrong shape for "found another
    // $400 of work, customer says yes, sign here".
    expect(h.onAddWork).toHaveBeenCalled();
  });

  it("still points back to the quote it was priced from", () => {
    render(<PriceSummary job={job({ sourceEstimateId: "est-1" })} {...handlers()} />);
    expect(screen.getByText(/View the quote/)).toBeTruthy();
  });
});

describe("a job signed at the door", () => {
  const signed = job({
    kind: "estimate",
    lines: [{ d: "Replace 50gal gas water heater", q: 1, r: 2650 }],
    signature: { name: "M. Rivera", at: "2026-08-03T16:00:00Z", svg: "<svg/>" } as never,
  });

  /**
   * THE PRICE SHOWS. The old svc-based gate hid the Price section on every estimate job forever
   * — including one a customer had signed at the door, the record that most certainly has a
   * price. The gate is isUnpricedEstimateJob now: estimate AND no priced lines.
   */
  it("shows its signed price — the record with a signature must show money", () => {
    render(<PriceSummary job={signed} {...handlers()} />);
    expect(screen.getByText("Replace 50gal gas water heater")).toBeTruthy();
  });

  /**
   * …BUT NOT AN EDIT PATH. A signature is evidence of what the customer agreed to. Build-the-
   * price replaces the lines while the signature record stays on screen — billing would then
   * invoice a total the customer never signed. Changes go through "+ More work", which
   * re-presents and re-signs.
   */
  it("offers no Edit on signed lines", () => {
    render(<PriceSummary job={signed} {...handlers()} />);
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.getByText("+ More work")).toBeTruthy();
  });

  it("a pure scoping visit still shows no price section at all", () => {
    render(<PriceSummary job={job({ kind: "estimate", lines: [] })} {...handlers()} />);
    expect(screen.queryByText("Price")).toBeNull();
  });
});

describe("a job carrying its own scope", () => {
  const priced = job({
    lines: [
      { d: "Slab leak — reroute", q: 1, r: 2400 },
      { d: "Drywall patch", q: 1, r: 300 },
    ],
  });

  it("lists the work, so the technician knows what was sold", () => {
    render(<PriceSummary job={priced} {...handlers()} />);
    expect(screen.getByText("Slab leak — reroute")).toBeTruthy();
    expect(screen.getByText("Drywall patch")).toBeTruthy();
  });

  it("offers + More work here too", () => {
    render(<PriceSummary job={priced} {...handlers()} />);
    expect(screen.getByText("+ More work")).toBeTruthy();
  });
});
