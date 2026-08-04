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
// DoneBlock carries NO Reopen.
//
// Reopen writes a VISIT status, so it lives once — in the "Your visit(s)" section, beside the
// visit it moves. It used to render here too, which meant a done job with a placed visit showed
// the office the SAME control twice, both firing the same write; and for a job completed
// straight from My Day (no placed visit at all) both copies were dead — the button took the tap
// and did nothing, because a job-level reopen does not exist.
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
};

describe("DoneBlock — the money card, and only the money card", () => {
  it("renders no Reopen of its own", () => {
    render(<DoneBlock {...doneBlockProps} />);
    expect(screen.queryByText("↩ Reopen")).toBeNull();
    expect(screen.getByText("✓ Job done")).toBeTruthy();
  });

  it("renders no Reopen on the already-billed branch either", () => {
    render(<DoneBlock {...doneBlockProps} job={{ ...doneJob, invRequested: true }} />);
    expect(screen.queryByText("↩ Reopen")).toBeNull();
    expect(screen.getByText("✓ Sent to the office")).toBeTruthy();
  });
});
