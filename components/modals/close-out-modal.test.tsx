// @vitest-environment jsdom
/**
 * components/modals/close-out-modal.test.tsx
 * BillAsk's "+ Service / diagnostic fee" chip (presetFee) used to hardcode the amount "89".
 * Task 5: it reads the org's real visit fee (passed down as `serviceFee`, read outside the
 * store on this surface — see features/settings/use-org-service-fee.ts, since the close-out
 * modal's only entry, the tech job modal, lives in the field shell) and falls back to 89 only
 * when the org fee genuinely isn't loaded/set.
 *
 * Also (rebuilt after review): CloseOutModalContent must NOT race its own auto-create effect
 * (which calls addInvoice with jobId+leadId set → the store's createFromJob path) against a
 * fee invoice the visit-fee flow already raised. It receives that invoice's id via the modal's
 * `invoiceId` param and must find it by id, never re-triggering createFromJob.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BillAsk, CloseOutModalContent } from "./close-out-modal";
import type { Job, Lead, Invoice } from "@/lib/store/types";
import { MODAL } from "@/lib/store/modal-ids";

// ---------------------------------------------------------------------------
// Store mock — used only by the CloseOutModalContent describe block below;
// harmless to the prop-driven BillAsk tests above, which never touch the store.
// ---------------------------------------------------------------------------

let mockActiveParams: Record<string, unknown> = {};
let mockJobs: Job[] = [];
let mockLeads: Lead[] = [];
let mockInvoices: Invoice[] = [];
const noop = vi.fn();
const mockAddInvoice = vi.fn(() => ({ id: "unexpected", num: "INV-999" }));

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "close-out", params: mockActiveParams }),
  useCloseModal: () => noop,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      jobs: mockJobs,
      invoices: mockInvoices,
      leads: mockLeads,
      services: [],
      addInvoice: mockAddInvoice,
      setInvoiceLines: noop,
      updateJob: noop,
      setJobLines: noop,
      recordPayment: noop,
      sendInvoice: noop,
      updateLead: noop,
      setAddonStatus: noop,
      setAddonInvSkip: noop,
      checkVerifyItem: noop,
      overrideVerifyItem: noop,
      addJobPhoto: noop,
    }),
}));

vi.mock("@/features/settings/use-org-service-fee", () => ({
  useOrgServiceFee: () => 89,
}));

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    leadId: "lead-1",
    svc: "estimate",
    origin: "db",
    title: "Fix water heater",
    addr: "12 Oak St",
    phone: "",
    status: "done",
    archived: false,
    lines: [],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [],
    ...overrides,
  };
}

describe("BillAsk — presetFee reads the org's real visit fee", () => {
  it("uses serviceFee 129 as the preset amount", () => {
    render(<BillAsk job={makeJob()} suggested={200} onCommit={vi.fn()} serviceFee={129} />);
    fireEvent.click(screen.getByText("Itemize"));
    fireEvent.click(screen.getByText("+ Service / diagnostic fee"));
    expect((screen.getByPlaceholderText("fee or part description") as HTMLInputElement).value).toBe(
      "Service / diagnostic call",
    );
    expect((screen.getByPlaceholderText("$") as HTMLInputElement).value).toBe("129");
  });

  it("falls back to 89 when serviceFee is 0 (org configured no fee / not genuinely set)", () => {
    render(<BillAsk job={makeJob()} suggested={200} onCommit={vi.fn()} serviceFee={0} />);
    fireEvent.click(screen.getByText("Itemize"));
    fireEvent.click(screen.getByText("+ Service / diagnostic fee"));
    expect((screen.getByPlaceholderText("$") as HTMLInputElement).value).toBe("89");
  });

  it("falls back to 89 when serviceFee is null (not loaded yet)", () => {
    render(<BillAsk job={makeJob()} suggested={200} onCommit={vi.fn()} serviceFee={null} />);
    fireEvent.click(screen.getByText("Itemize"));
    fireEvent.click(screen.getByText("+ Service / diagnostic fee"));
    expect((screen.getByPlaceholderText("$") as HTMLInputElement).value).toBe("89");
  });

  it("does not overwrite an amount the user already typed", () => {
    render(<BillAsk job={makeJob()} suggested={200} onCommit={vi.fn()} serviceFee={129} />);
    fireEvent.click(screen.getByText("Itemize"));
    fireEvent.change(screen.getByPlaceholderText("$"), { target: { value: "50" } });
    fireEvent.click(screen.getByText("+ Service / diagnostic fee"));
    expect((screen.getByPlaceholderText("$") as HTMLInputElement).value).toBe("50");
  });
});

// ---------------------------------------------------------------------------
// CloseOutModalContent — the visit-fee flow's invoiceId param must be honored so the mount
// effect never races the already-raised fee invoice with its own createFromJob-triggering
// addInvoice call.
// ---------------------------------------------------------------------------

const feeJob: Job = {
  id: "job-1",
  leadId: "lead-1",
  svc: "estimate",
  origin: "db",
  title: "Fix water heater",
  addr: "12 Oak St",
  phone: "",
  status: "done",
  archived: false,
  lines: [], // genuinely unpriced — createFromJob would CONFLICT if it ever fired here
  addons: [],
  photos: [],
  notes: "",
  acts: [],
  visits: [{ id: "v1", date: "2026-07-12", techId: "tech-1", start: 9, dur: 2, status: "done" }],
};

const feeLead: Lead = { id: "lead-1", name: "Dana Alvarez", phone: "555-0101", stage: "Won" } as unknown as Lead;

// Hydrator-shaped: jobId null (the server never stamps sourceJobId on a manual invoice).
const feeInvoice: Invoice = {
  id: "inv-fee-1", num: "INV-900", jobId: null, leadId: "lead-1", cust: "Dana", phone: "",
  title: "Visit fee — service call", lines: [{ d: "Visit fee — service call", q: 1, r: 89 }],
  total: 89, depPaid: 0, payments: [], status: "sent", age: 0, archived: false,
} as unknown as Invoice;

describe("CloseOutModalContent — the visit-fee flow's invoiceId param", () => {
  beforeEach(() => {
    mockJobs = [feeJob];
    mockLeads = [feeLead];
    mockInvoices = [feeInvoice];
    mockAddInvoice.mockClear();
  });

  it("finds the fee invoice by id and never calls addInvoice (no createFromJob race)", () => {
    mockActiveParams = { jobId: "job-1", invoiceId: "inv-fee-1" };
    render(<CloseOutModalContent />);
    // DueCard rendered with the fee invoice's amount — proof it was actually found, not just
    // silently blocked from auto-creating a replacement.
    expect(screen.getByText("$89")).toBeTruthy();
    expect(mockAddInvoice).not.toHaveBeenCalled();
  });

  it("still auto-creates via addInvoice for the normal (non-fee) close-out path with no invoiceId param", () => {
    mockActiveParams = { jobId: "job-1" }; // no invoiceId — DoneBlock's ordinary openCloseOut
    mockInvoices = []; // no invoice yet for this job
    render(<CloseOutModalContent />);
    expect(mockAddInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", leadId: "lead-1" }),
    );
  });

  it("MODAL.CLOSE_OUT id constant matches what the mock returns", () => {
    expect(MODAL.CLOSE_OUT).toBe("close-out");
  });
});
