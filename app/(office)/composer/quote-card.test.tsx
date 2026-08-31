// @vitest-environment jsdom
/**
 * app/(office)/composer/quote-card.test.tsx
 *
 * Guards the composer's empty state, which used to be actively broken.
 *
 * The line table was hidden behind a "What's the job?" hero until a line had a non-blank
 * description. But "+ Add line" appends a BLANK line — so the click mutated state, `quoteIsEmpty`
 * stayed true, the hero kept rendering, and nothing appeared. You could click it five times and
 * see nothing happen; then opening the pricebook flipped the body on and five blank rows appeared
 * at once. These tests pin the table as the always-visible body.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuoteCard } from "./quote-card";
import { INITIAL_STATE, type ComposerState } from "./composer-state";

function renderCard(over: Partial<ComposerState> = {}) {
  const onUpdate = vi.fn();
  const state: ComposerState = { ...INITIAL_STATE, ...over };
  render(
    <QuoteCard
      state={state}
      onUpdate={onUpdate}
      onAiDraft={vi.fn()}
      onRefine={vi.fn()}
      proposals={[]}
      onAcceptProposal={vi.fn()}
      onDismissProposal={vi.fn()}
      proposalError={null}
      onSuggestBetterBest={vi.fn()}
      isDrafting={false}
      aiDraftError={null}
      services={[]}
      materials={[]}
      run={null}
      onRunDone={vi.fn()}
      materialize={false}
    />,
  );
  return { onUpdate, state };
}

describe("QuoteCard — the empty composer", () => {
  /**
   * A quote with nothing on it shows the mock's empty state rather than a blank row.
   *
   * This REVERSES an earlier decision here ("the editable row is there from the start — you can
   * just start typing"). That decision was a reaction to a marketing HERO blocking the editor,
   * and it fixed the right problem the wrong way: a single blank row asks the office to decode
   * an empty form. The mock — which is the spec — states what a line is and offers the two ways
   * to make one. What must NOT come back is the hero, and that is asserted below.
   */
  it("says what a line is, and offers the two ways to make one", () => {
    renderCard();
    expect(screen.getByText("No line items yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Add line item" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /From pricebook/ })).toBeTruthy();
    // The hero stays gone. That is what the earlier fix was actually protecting.
    expect(screen.queryByText("What’s the job?")).toBeNull();
    expect(screen.queryByText(/the quote\s+builds itself from your pricebook below/i)).toBeNull();
  });

  it("makes '+ Add line item' append a row that is actually rendered", () => {
    // The regression this has always guarded: a blank appended line must still show up.
    // Previously the state updated and the UI did not, because a blank line did not count as
    // a "real" line.
    const { onUpdate, state } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "+ Add line item" }));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const next = onUpdate.mock.calls[0]![0] as Partial<ComposerState>;
    expect(next.lines).toHaveLength(state.lines.length + 1);

    // Re-render with the produced state: the table takes over from the empty state.
    renderCard({ lines: next.lines });
    expect(screen.getAllByPlaceholderText("Describe the work…").length).toBeGreaterThan(0);
  });

  it("shows the empty state whether or not the pricebook panel is open", () => {
    // The old body was gated on `!(quoteIsEmpty && !pbOpen)`, which is why opening the pricebook
    // was what finally revealed the accumulated blank rows.
    renderCard({ pbOpen: false });
    expect(screen.getByText("No line items yet")).toBeTruthy();
  });

  it("gives way to the table the moment a line has something written on it", () => {
    renderCard({ lines: [{ d: "Water heater", q: 1, r: 1450 }] });
    expect(screen.queryByText("No line items yet")).toBeNull();
    expect(screen.getByLabelText("Description, line 1")).toBeTruthy();
  });
});

describe("QuoteCard — per-line tax, now in the inspector rail", () => {
  // The No-tax CHIP moved off the row into the rail (the mock's model): select the line,
  // and Tax is a property. The gate is unchanged — with no tax rate the row would decide
  // nothing, so it does not render.
  const priced = { d: "Water heater", q: 1, r: 1_450 };
  const selectRow = () => fireEvent.click(screen.getByLabelText("Description, line 1"));

  it("shows no Tax property on a quote with no tax rate — there is nothing for it to decide", () => {
    renderCard({ lines: [priced], pricing: { disc: 0, dep: 0, tax: 0 } });
    selectRow();
    expect(screen.queryByText("Tax")).toBeNull();
  });

  it("shows Taxable once the quote charges tax — the default, stated", () => {
    renderCard({ lines: [priced], pricing: { disc: 0, dep: 0, tax: 8.25 } });
    selectRow();
    expect(screen.getByText("Tax")).toBeTruthy();
    expect(screen.getByText("Taxable")).toBeTruthy();
  });

  it("marks the line non-taxable when clicked, and states it when already set", () => {
    const { onUpdate } = renderCard({ lines: [priced], pricing: { disc: 0, dep: 0, tax: 8.25 } });
    selectRow();
    fireEvent.click(screen.getByText("Tax").closest("button")!);
    const next = onUpdate.mock.calls.at(-1)![0] as Partial<ComposerState>;
    expect(next.lines?.[0]?.notax).toBe(true);

    renderCard({ lines: [{ ...priced, notax: true }], pricing: { disc: 0, dep: 0, tax: 8.25 } });
    // Two cards are mounted at this point (this test renders twice) — act on the second.
    fireEvent.click(screen.getAllByLabelText("Description, line 1").at(-1)!);
    expect(screen.getByText("No tax")).toBeTruthy();
  });
});

describe("QuoteCard — an empty pricebook points somewhere real", () => {
  it("links to the Office pricebook tab, not to Settings", () => {
    // The pricebook lives on /dashboard?tab=pricebook. The old copy said "Settings → Pricebook",
    // which is a route that does not contain it — a dead end for a shop with nothing in the book.
    renderCard({ pbOpen: true });
    const link = screen.getByRole("link", { name: "Add your services" });
    expect(link.getAttribute("href")).toBe("/dashboard?tab=pricebook");
    expect(screen.queryByText(/Settings → Pricebook/)).toBeNull();
  });
});

describe("QuoteCard — no explainer card under the bar", () => {
  it("renders the bar alone, with no first-run pitch", () => {
    // A three-column "READS THE JOB / PRICES LIKE YOU / CHECKS YOUR WINS" card used to sit under
    // the command bar on first visit. It explained the product to someone already using it, and it
    // pushed the actual quote off the screen. Deleted — the bar's placeholder says enough.
    renderCard();
    expect(screen.queryByText(/Reads the job/i)).toBeNull();
    expect(screen.queryByText(/Prices like you/i)).toBeNull();
    expect(screen.queryByText(/Checks your wins/i)).toBeNull();
    expect(screen.queryByText(/it remembers for next time/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Got it" })).toBeNull();
  });
});

describe("QuoteCard — a seeded job description (?desc= handoff)", () => {
  it("shows the seeded description in the command bar with Build it enabled", () => {
    // The new-customer modal's Build-the-price hands off with ?desc=<typed job>;
    // the page seeds it into state.desc and the bar must surface it — a seed
    // the office can't see or run isn't a carry, it's a drop.
    renderCard({ desc: "swap 50-gal water heater" });
    const bar = screen.getByLabelText("Describe the job") as HTMLInputElement;
    expect(bar.value).toBe("swap 50-gal water heater");
    const go = screen.getByRole("button", { name: "Build it" }) as HTMLButtonElement;
    expect(go.disabled).toBe(false);
  });
});
