// @vitest-environment jsdom
/**
 * components/modals/money-pointer.test.tsx
 *
 * The office job modal's money pointer must have NO money story for a done,
 * unpriced ESTIMATE: the old "Create the invoice →" on a finished scoping visit
 * minted a meaningless $0 draft. Signed estimates (priced lines) stay billable.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MoneyPointer } from "./money-pointer";
import type { Invoice, Job } from "@/lib/store/types";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    leadId: "lead-1",
    svc: "service",
    origin: "db",
    title: "Fix water heater",
    status: "done",
    archived: false,
    lines: [],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [],
    ...overrides,
  } as Job;
}

const pointer = (job: Job, invoice?: Invoice) =>
  render(
    <MoneyPointer
      job={job}
      invoice={invoice}
      onBill={vi.fn()}
      billing={false}
      billError={null}
      onOpenInvoice={vi.fn()}
    />,
  );

describe("MoneyPointer", () => {
  it("renders NOTHING for a done, unpriced estimate — a scoping visit has no invoice step", () => {
    const { container } = pointer(makeJob({ svc: "estimate", lines: [] }));
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing even when a stale $0 draft already exists on the unpriced estimate", () => {
    const zeroDraft = {
      id: "inv-1",
      num: "INV-1",
      jobId: "job-1",
      total: 0,
      depPaid: 0,
      payments: [],
      status: "draft",
    } as unknown as Invoice;
    const { container } = pointer(makeJob({ svc: "estimate", lines: [] }), zeroDraft);
    expect(container.innerHTML).toBe("");
  });

  it("offers 'Create the invoice →' on a done estimate SIGNED on site (priced lines)", () => {
    pointer(makeJob({ svc: "estimate", lines: [{ d: "Repaint hall", q: 1, r: 400 }] }));
    expect(screen.getByText("Create the invoice →")).toBeTruthy();
  });

  it("offers 'Create the invoice →' on a done service job with no invoice", () => {
    pointer(makeJob());
    expect(screen.getByText("Create the invoice →")).toBeTruthy();
  });

  it("points at the invoice once a priced one exists", () => {
    const invoice = {
      id: "inv-1",
      num: "INV-9",
      jobId: "job-1",
      total: 300,
      depPaid: 0,
      payments: [],
      status: "sent",
    } as unknown as Invoice;
    pointer(makeJob(), invoice);
    expect(screen.getByText("INV-9 — $300 due")).toBeTruthy();
    expect(screen.getByText("open invoice →")).toBeTruthy();
  });

  it("renders nothing while the work is not done yet", () => {
    const { container } = pointer(makeJob({ status: "scheduled" }));
    expect(container.innerHTML).toBe("");
  });
});
