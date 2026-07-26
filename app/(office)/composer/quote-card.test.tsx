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
      run={null}
      onRunDone={vi.fn()}
      materialize={false}
    />,
  );
  return { onUpdate, state };
}

describe("QuoteCard — the empty composer", () => {
  it("shows the line editor immediately, with no hero in the way", () => {
    renderCard();
    // The editable row is there from the start — you can just start typing.
    expect(screen.getByPlaceholderText("Describe the work…")).toBeTruthy();
    expect(screen.queryByText("What’s the job?")).toBeNull();
    expect(screen.queryByText(/the quote\s+builds itself from your pricebook below/i)).toBeNull();
  });

  it("makes '+ Add line' append a row that is actually rendered", () => {
    // The regression itself: a blank appended line must still show up. Previously the state
    // updated and the UI did not, because a blank line did not count as a "real" line.
    const { onUpdate, state } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "+ Add line" }));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const next = onUpdate.mock.calls[0]![0] as Partial<ComposerState>;
    expect(next.lines).toHaveLength(state.lines.length + 1);

    // Re-render with the produced state: the new blank row renders rather than vanishing.
    renderCard({ lines: next.lines });
    expect(screen.getAllByPlaceholderText("Describe the work…").length).toBeGreaterThan(1);
  });

  it("keeps the editor visible whether or not the pricebook panel is open", () => {
    // The old body was gated on `!(quoteIsEmpty && !pbOpen)`, which is why opening the pricebook
    // was what finally revealed the accumulated blank rows.
    renderCard({ pbOpen: false });
    expect(screen.getByPlaceholderText("Describe the work…")).toBeTruthy();
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
