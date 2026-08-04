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
import { DoneBlock, ScopeHandoffBlock } from "./done-block";
import type { Job } from "@/lib/store/types";

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

// ---------------------------------------------------------------------------
// DoneBlock — Reopen is a VISIT write, so it must not render when there is no visit to move.
//
// THE BUG: a job completed straight from My Day has no PLACED visit (the field only shows
// placed ones), so the handler had nothing to call. The button rendered anyway, took the tap
// and did nothing.
// ---------------------------------------------------------------------------

const doneJob = {
  id: "job-1", leadId: "lead-1", svc: "service", origin: "db", title: "Water heater",
  addr: "12 Oak St", phone: "", status: "done", archived: false,
  lines: [{ d: "Flat rate", q: 1, r: 185 }], addons: [], photos: [], notes: "", acts: [], visits: [],
} as unknown as Job;

const doneBlockProps = {
  job: doneJob,
  lead: undefined,
  invoice: undefined,
  onOpenCloseOut: vi.fn(),
  onOpenInvoice: vi.fn(),
  onChargeOnFile: vi.fn(),
  onSendToOffice: vi.fn(),
  onReopen: vi.fn(),
};

describe("DoneBlock — Reopen is hidden when there is nothing to reopen", () => {
  it("no placed visit → no Reopen button", () => {
    render(<DoneBlock {...doneBlockProps} canReopen={false} />);
    expect(screen.queryByText("↩ Reopen")).toBeNull();
    // The card itself still renders — hiding a dead control must not blank the hero.
    expect(screen.getByText("✓ Job done")).toBeTruthy();
  });

  it("a placed visit → Reopen renders and fires", () => {
    const onReopen = vi.fn();
    render(<DoneBlock {...doneBlockProps} onReopen={onReopen} canReopen={true} />);
    fireEvent.click(screen.getByText("↩ Reopen"));
    expect(onReopen).toHaveBeenCalledTimes(1);
  });
});
