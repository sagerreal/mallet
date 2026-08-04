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
import { DoneBlock, ScopeHandoffBlock, doneFootAction } from "./done-block";
import type { Invoice, Job } from "@/lib/store/types";

describe("ScopeHandoffBlock — visit fee collection", () => {
  it("unscoped: renders the fee button AND the quiet 'Open the Quote tab' handoff stays", () => {
    render(
      <ScopeHandoffBlock
        scoped={false}
        onOpenQuoteTab={vi.fn()}
        canCollectFee={true}
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
        canCollectFee={true}
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
        canCollectFee={true}
        feeAmount={89}
        hasFeeInvoice={true}
        onCollectFee={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Collect the visit fee/)).toBeNull();
    // The quiet handoff never gets blocked by the guard.
    expect(screen.getByText("Open the Quote tab →")).toBeTruthy();
  });

  it("fee button absent when this viewer may not collect (office with no fee set)", () => {
    render(
      <ScopeHandoffBlock
        scoped={false}
        onOpenQuoteTab={vi.fn()}
        canCollectFee={false}
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
        canCollectFee={true}
        feeAmount={89}
        hasFeeInvoice={false}
        onCollectFee={onCollectFee}
      />,
    );
    fireEvent.click(screen.getByText("Collect the visit fee — $89"));
    expect(onCollectFee).toHaveBeenCalledTimes(1);
  });

  // The field surface cannot read v1.settings.get (ownerOrOffice), so it never knows the number.
  // It does not need to: raiseVisitFee reads the fee from the shop's own settings, which is
  // exactly why the amount is not an input. The button names no figure rather than a wrong one.
  it("a technician gets the button with NO amount when this device can't read the fee", () => {
    const onCollectFee = vi.fn();
    render(
      <ScopeHandoffBlock
        scoped={false}
        onOpenQuoteTab={vi.fn()}
        canCollectFee={true}
        feeAmount={null}
        hasFeeInvoice={false}
        onCollectFee={onCollectFee}
      />,
    );
    expect(screen.getByText("Collect the visit fee →")).toBeTruthy();
    expect(screen.queryByText(/Collect the visit fee — \$/)).toBeNull();
    fireEvent.click(screen.getByText("Collect the visit fee →"));
    expect(onCollectFee).toHaveBeenCalledTimes(1);
  });

  it("no button at all for a viewer who may not collect (a tech NOT on this job)", () => {
    render(
      <ScopeHandoffBlock
        scoped={false}
        onOpenQuoteTab={vi.fn()}
        canCollectFee={false}
        feeAmount={null}
        hasFeeInvoice={false}
        onCollectFee={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Collect the visit fee/)).toBeNull();
    expect(screen.getByText("Open the Quote tab →")).toBeTruthy();
  });

  it("surfaces a fee error beneath the handoff when the collect write fails", () => {
    render(
      <ScopeHandoffBlock
        scoped={false}
        onOpenQuoteTab={vi.fn()}
        canCollectFee={true}
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

// ---------------------------------------------------------------------------
// The technician's close-out card. Every control here that writes through an ownerOrOffice
// endpoint with no field sibling must be ABSENT for them — a tap that FORBIDDENs and rolls back
// silently is worse than no button — while the money itself stays fully visible.
// ---------------------------------------------------------------------------

const hiddenPriceJob = {
  ...doneJob,
  // What the server sends a redacted device: the descriptions, the rate NULLED. Not $0.
  lines: [{ d: "Flat rate", q: 1, r: null }],
} as unknown as Job;

const paidInvoice = {
  id: "inv-1", num: "INV-810", jobId: "job-1", leadId: "lead-1", cust: "Dana", phone: "",
  title: "Water heater", lines: [], total: 185, depPaid: 0,
  payments: [{ amt: 185, when: "Just now", method: "cash" }],
  status: "paid", age: 0, archived: false, origin: "db",
} as unknown as Invoice;

describe("DoneBlock — the field capabilities", () => {
  it("a technician gets no hand-off button (job.invRequested is an office write)", () => {
    render(<DoneBlock {...doneBlockProps} canSendToOffice={false} canSetBill={false} />);
    expect(screen.getByText("✓ Job done")).toBeTruthy();
    expect(screen.getByText("$185")).toBeTruthy(); // the money is still fully theirs to read
    expect(screen.queryByText("Send to the office to bill")).toBeNull();
  });

  it("a technician gets no 'Set a bill' on an unpriced job — the builder has no field route", () => {
    const unpriced = { ...doneJob, lines: [] } as unknown as Job;
    render(
      <DoneBlock {...doneBlockProps} job={unpriced} canSendToOffice={false} canSetBill={false} />,
    );
    expect(screen.getByText("No price set — the office invoices it.")).toBeTruthy();
    expect(screen.queryByText("Set a bill & take payment →")).toBeNull();
  });

  it("a technician gets no receipt link on a paid bill (the invoice modal is the office record)", () => {
    render(
      <DoneBlock
        {...doneBlockProps}
        invoice={paidInvoice}
        onOpenInvoice={undefined}
        canSendToOffice={false}
        canSetBill={false}
      />,
    );
    expect(screen.getByText("✓ Paid · $185")).toBeTruthy();
    expect(screen.queryByText("receipt & invoice")).toBeNull();
  });

  it("the office still gets the receipt link", () => {
    render(<DoneBlock {...doneBlockProps} invoice={paidInvoice} />);
    expect(screen.getByText("receipt & invoice")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// HIDDEN PRICES ARE NOT MISSING PRICES. This is the single most damaging way the done card can
// be wrong: a shop with techSeesPrice off sends every rate as null, the job sums to $0, and the
// old code told the technician at the door "No price set — the office invoices it" on a job he
// was sent out to collect on.
// ---------------------------------------------------------------------------

describe("DoneBlock / doneFootAction — a redacted device is not a free job", () => {
  it("says prices are hidden and offers the bill, never 'No price set'", () => {
    render(
      <DoneBlock
        {...doneBlockProps}
        job={hiddenPriceJob}
        canSendToOffice={false}
        canSetBill={false}
      />,
    );
    expect(screen.queryByText("No price set — the office invoices it.")).toBeNull();
    expect(
      screen.getByText("Prices are hidden on your device — open the bill to see what’s due."),
    ).toBeTruthy();
    expect(screen.getByText("Open the bill & take payment →")).toBeTruthy();
  });

  it("the foot action is collect, not sendoffice", () => {
    expect(doneFootAction(hiddenPriceJob, undefined, undefined, false)).toBe("collect");
  });

  it("a genuinely unpriced job with no hand-off has NO foot action (a plain Done)", () => {
    const unpriced = { ...doneJob, lines: [] } as unknown as Job;
    expect(doneFootAction(unpriced, undefined, undefined, false)).toBeNull();
    // The office is unchanged — it still gets the hand-off.
    expect(doneFootAction(unpriced, undefined, undefined)).toBe("sendoffice");
  });

  it("once the invoice is loaded its OWN balance decides — the redaction stops mattering", () => {
    const due = { ...paidInvoice, status: "sent", payments: [] } as unknown as Invoice;
    expect(doneFootAction(hiddenPriceJob, undefined, due, false)).toBe("collect");
  });
});
