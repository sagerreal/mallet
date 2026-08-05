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
import type { Invoice, Job, Lead } from "@/lib/store/types";
// The two REAL mappers the card's job comes through: the hydrator's list mapper (v1.jobs.list /
// v1.field.myDay) and the mutation-reconcile mapper (every job-returning mutation).
import { toStoreJob } from "@/features/jobs/jobs-hydrator";
import { dtoJobToStoreJob } from "@/lib/store/dto-mapper";

/** A v1.jobs.list row, shaped as the wire sends it. */
const listJob = (o: Record<string, unknown>): Job =>
  toStoreJob({
    num: "JOB-2545", leadId: "lead-1", customerName: "Dana", sourceEstimateId: null,
    title: "Flat rate test 3", svc: "service", kind: "work", assigneeUserId: null,
    scheduledStart: null, total: { cents: 0, currency: "USD" }, notes: "", addr: "", phone: "",
    completion: null, invRequested: false, scope: null, callbackOf: null, callbackReason: null,
    checklist: null, requiredCerts: null, visits: [], createdAt: "2026-08-04T22:35:40.743Z",
    lines: [], addons: [], verifyAnswers: [], photos: [],
    ...o,
  } as never);

/** A full jobDTO, as every job-returning mutation now answers with. */
const mutationJob = (o: Record<string, unknown>): Job =>
  dtoJobToStoreJob({
    num: "JOB-2545", leadId: "lead-1", sourceEstimateId: null, assigneeUserId: null,
    title: "Flat rate test 3", svc: "service", kind: "work", scheduledStart: null,
    scheduledEnd: null, startedAt: null, completedAt: null, canceledAt: null, cancelReason: null,
    total: { cents: 18500, currency: "USD" }, notes: "", addr: "", phone: "", completion: null,
    invRequested: false, scope: null, callbackOf: null, callbackReason: null, checklist: null,
    requiredCerts: null, signature: null, visits: [], createdAt: "2026-08-04T22:35:40.743Z",
    lines: [], addons: [], verifyAnswers: [], photos: [],
    ...o,
  } as never);

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
  // NOBODY gets a hand-off button in the hero any more, technician or office. On a job with
  // money owed the card offers taking the money and nothing else: the close-out one tap away
  // already carries "Take payment — $x" AND "Log & send to office →" side by side, so the hero
  // was asking for a choice one screen before the screen that offers both — and on this branch
  // it contradicted its own foot, which says "Take payment →".
  it("no hand-off button on a job with money owed — the close-out carries it", () => {
    render(<DoneBlock {...doneBlockProps} canSetBill={false} />);
    expect(screen.getByText("✓ Job done")).toBeTruthy();
    expect(screen.getByText("$185")).toBeTruthy(); // the money is still fully theirs to read
    expect(screen.queryByText("Send to the office to bill")).toBeNull();
  });

  it("the office gets no hand-off button either — the redundancy was not role-specific", () => {
    render(<DoneBlock {...doneBlockProps} />);
    expect(screen.queryByText("Send to the office to bill")).toBeNull();
  });

  it("with a card on file the one quiet peer is the OTHER way to get paid", () => {
    const withCard = { name: "Dana", card: { brand: "Visa", last4: "4242" } } as unknown as Lead;
    render(<DoneBlock {...doneBlockProps} lead={withCard} />);
    // The foot carries the charge; this peer is the alternative payment route, not an exit.
    expect(screen.getByText("Take payment another way →")).toBeTruthy();
    expect(screen.queryByText("Send to the office to bill")).toBeNull();
  });

  it("a technician gets no 'Set a bill' on an unpriced job — the builder has no field route", () => {
    const unpriced = { ...doneJob, lines: [] } as unknown as Job;
    render(<DoneBlock {...doneBlockProps} job={unpriced} canSetBill={false} />);
    expect(screen.getByText("No price set — the office invoices it.")).toBeTruthy();
    expect(screen.queryByText("Set a bill & take payment →")).toBeNull();
  });

  it("a technician gets no receipt link on a paid bill (the invoice modal is the office record)", () => {
    render(
      <DoneBlock
        {...doneBlockProps}
        invoice={paidInvoice}
        onOpenInvoice={undefined}
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
    render(<DoneBlock {...doneBlockProps} job={hiddenPriceJob} canSetBill={false} />);
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

// ---------------------------------------------------------------------------
// THE CARD MUST NOT FLAP. A priced job read through the LIST shape and the same job read through a
// MUTATION response have to produce the same card, because a refetch cycle alternates between
// them. They did not: the mutation responses carried no execution at all, so tapping a visit made
// the card read "No price set — the office invoices it" on JOB-2545's agreed $185, and the next
// list refetch put the $185 straight back.
//
// Built through the REAL mappers rather than store fixtures — the whole failure was the gap
// between two wire shapes, and a fixture written by hand tests neither of them.
// ---------------------------------------------------------------------------

describe("DoneBlock — the two wire shapes agree, so the card cannot flap", () => {
  const priceLine = {
    id: "line-1",
    description: "Annual plumbing inspection",
    quantity: 1,
    rate: { cents: 18500, currency: "USD" },
    cost: { cents: 4000, currency: "USD" },
    position: 0,
  };

  const cardFor = (job: Job) =>
    render(<DoneBlock {...doneBlockProps} job={job} canSetBill={false} />);

  it("the LIST row renders the price, never 'No price set'", () => {
    const job = listJob({
      id: "job-2545",
      status: "complete",
      total: { cents: 0, currency: "USD" }, // the stale header total — the lines are the truth
      lines: [priceLine],
    });
    cardFor(job);
    expect(screen.getByText("$185")).toBeTruthy();
    expect(screen.queryByText("No price set — the office invoices it.")).toBeNull();
  });

  it("the MUTATION response renders the same card", () => {
    const job = mutationJob({ id: "job-2545", status: "complete", lines: [priceLine] });
    cardFor(job);
    expect(screen.getByText("$185")).toBeTruthy();
    expect(screen.queryByText("No price set — the office invoices it.")).toBeNull();
  });

  it("and the foot action agrees across both shapes — take the money, on both", () => {
    const fromList = listJob({ id: "job-2545", status: "complete", lines: [priceLine] });
    const fromMutation = mutationJob({ id: "job-2545", status: "complete", lines: [priceLine] });
    expect(doneFootAction(fromList, undefined, undefined)).toBe("collect");
    expect(doneFootAction(fromMutation, undefined, undefined)).toBe("collect");
  });

  it("the lines-less shape is what used to break it — the foot went to hand-off", () => {
    // Pinning the DIFFERENCE, so the value of the router fix is stated rather than assumed: a job
    // whose price is missing from the response is offered to the office to bill instead of
    // collected at the door. The routers no longer send this shape (toJobDTOWithExecution) and the
    // store no longer accepts it over a priced job (withExecution in jobs-slice).
    const stripped = mutationJob({ id: "job-2545", status: "complete", lines: [] });
    expect(doneFootAction(stripped, undefined, undefined)).toBe("sendoffice");
  });

  it("a job with genuinely no lines still says so, on either shape", () => {
    // The sentence has to stay reachable — it is the honest answer for unpriced work.
    const fromList = listJob({ id: "job-none", status: "complete", lines: [] });
    cardFor(fromList);
    expect(screen.getByText("No price set — the office invoices it.")).toBeTruthy();
  });
});
