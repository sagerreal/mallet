// @vitest-environment jsdom
/**
 * WORK ORDER money must agree with the bill. The section used to render the raw line sum as
 * "Total", so a $100 job carrying the shop's stored 8.45% sales tax read "$100" on the
 * technician's sheet while the invoice billed $108.45 — two totals for one job, at the door.
 * The section now derives the same Subtotal → Discount → Sales tax → Total chain the invoice
 * bills (job.pricing through deriveTotals), rendered with the field builder's own breakdown.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkOrderSec, workOrderPropsEqual } from "./work-order-sec";
import type { Job } from "@/lib/store/types";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    leadId: "lead-1",
    svc: "service",
    origin: "db",
    title: "Drain clear",
    addr: "12 Oak St",
    phone: "",
    status: "scheduled",
    archived: false,
    lines: [{ d: "Drain clear", q: 1, r: 100 }],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [],
    ...overrides,
  } as Job;
}

describe("WorkOrderSec — stored discount/tax render as the billed breakdown", () => {
  it("renders Subtotal → Sales tax → the tax-inclusive Total, matching the invoice", () => {
    render(<WorkOrderSec job={makeJob({ pricing: { disc: 0, tax: 8.45 } })} seesPrice />);
    expect(screen.getByText("Subtotal")).toBeTruthy();
    expect(screen.getByText("Sales tax 8.45%")).toBeTruthy();
    expect(screen.getByText("$108.45")).toBeTruthy();
  });

  it("the header total is the billed total, never the line sum", () => {
    render(<WorkOrderSec job={makeJob({ pricing: { disc: 0, tax: 8.45 } })} seesPrice />);
    expect(screen.getByText(/1 item · \$108\.45/)).toBeTruthy();
  });

  it("renders the Discount row when a discount is stored", () => {
    render(<WorkOrderSec job={makeJob({ pricing: { disc: 10, tax: 8.45 } })} seesPrice />);
    expect(screen.getByText("Discount")).toBeTruthy();
    // discount → net → tax: 100 − 10 = 90, + round(90 × 8.45%) = $97.61
    expect(screen.getByText("$97.61")).toBeTruthy();
  });

  it("keeps the plain Total row when the job stores no rates", () => {
    render(<WorkOrderSec job={makeJob()} seesPrice />);
    expect(screen.getByText("Total")).toBeTruthy();
    // The line's own amount and the Total row both read "$100" — the point is that no
    // breakdown (and no cent-formatted chain figure) appears without stored rates.
    expect(screen.getAllByText("$100").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Subtotal")).toBeNull();
  });

  it("withheld prices show no breakdown — the plain sentence stands", () => {
    render(
      <WorkOrderSec
        job={makeJob({ lines: [{ d: "Drain clear", q: 1, r: null }], pricing: { disc: 0, tax: 8.45 } })}
        seesPrice
      />,
    );
    expect(screen.queryByText("Subtotal")).toBeNull();
    expect(screen.getByText(/prices aren.t shown on your device/i)).toBeTruthy();
  });
});

describe("workOrderPropsEqual — pricing is compared (the stale-comparator trap)", () => {
  it("a pricing change re-renders the section", () => {
    const a = { job: makeJob({ pricing: { disc: 0, tax: 8.45 } }), seesPrice: true };
    const b = { job: makeJob({ pricing: { disc: 0, tax: 9.5 } }), seesPrice: true };
    // Same lines/photos identity, different pricing object → must NOT be equal.
    const shared = a.job.lines;
    b.job.lines = shared;
    b.job.photos = a.job.photos;
    expect(workOrderPropsEqual(a, b)).toBe(false);
  });
});
