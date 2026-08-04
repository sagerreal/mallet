// @vitest-environment jsdom
/**
 * components/modals/tech-job-modal/done-block.test.tsx
 * ScopeHandoffBlock — the done state for an unpriced ESTIMATE (a pure scoping visit).
 * Task 5 adds a secondary "Collect the visit fee" action beside the quiet handoff: the org's
 * real visit fee (read outside the store — see use-org-service-fee.ts) becomes collectable on
 * a declined estimate, without ever blocking or replacing the office-builds-the-quote handoff.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScopeHandoffBlock } from "./done-block";

describe("ScopeHandoffBlock — visit fee collection", () => {
  it("unscoped: renders the fee button AND the quiet 'Open the Quote tab' handoff stays", () => {
    render(
      <ScopeHandoffBlock
        scoped={false}
        onOpenQuoteTab={vi.fn()}
        feeAmount={89}
        hasFeeInvoice={false}
        onCollectFee={vi.fn()}
      />,
    );
    expect(screen.getByText("Collect the visit fee — $89")).toBeTruthy();
    expect(screen.getByText("Open the Quote tab →")).toBeTruthy();
  });

  it("scoped: renders the fee button beside the office-builds-the-quote handoff", () => {
    render(
      <ScopeHandoffBlock
        scoped={true}
        onOpenQuoteTab={vi.fn()}
        feeAmount={89}
        hasFeeInvoice={false}
        onCollectFee={vi.fn()}
      />,
    );
    expect(screen.getByText("✓ Scoped — the office builds the quote")).toBeTruthy();
    expect(screen.getByText("Collect the visit fee — $89")).toBeTruthy();
  });

  it("fee button absent when a fee invoice already exists for this job", () => {
    render(
      <ScopeHandoffBlock
        scoped={false}
        onOpenQuoteTab={vi.fn()}
        feeAmount={89}
        hasFeeInvoice={true}
        onCollectFee={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Collect the visit fee/)).toBeNull();
    // The quiet handoff never gets blocked by the guard.
    expect(screen.getByText("Open the Quote tab →")).toBeTruthy();
  });

  it("fee button absent when the org fee is 0/unset — no $0 fee collection", () => {
    render(
      <ScopeHandoffBlock
        scoped={false}
        onOpenQuoteTab={vi.fn()}
        feeAmount={0}
        hasFeeInvoice={false}
        onCollectFee={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Collect the visit fee/)).toBeNull();
  });

  it("tapping the fee button calls onCollectFee", () => {
    const onCollectFee = vi.fn();
    render(
      <ScopeHandoffBlock
        scoped={false}
        onOpenQuoteTab={vi.fn()}
        feeAmount={89}
        hasFeeInvoice={false}
        onCollectFee={onCollectFee}
      />,
    );
    fireEvent.click(screen.getByText("Collect the visit fee — $89"));
    expect(onCollectFee).toHaveBeenCalledTimes(1);
  });

  it("surfaces a fee error beneath the handoff when the collect write fails", () => {
    render(
      <ScopeHandoffBlock
        scoped={false}
        onOpenQuoteTab={vi.fn()}
        feeAmount={89}
        hasFeeInvoice={false}
        onCollectFee={vi.fn()}
        feeError="Couldn't collect the fee — check your connection and try again."
      />,
    );
    expect(
      screen.getByText("Couldn't collect the fee — check your connection and try again."),
    ).toBeTruthy();
  });
});
