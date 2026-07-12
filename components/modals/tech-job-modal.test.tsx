// @vitest-environment jsdom
/**
 * components/modals/tech-job-modal.test.tsx
 *
 * Guards the field-surface role gate: the tech modal is shared by owner/office
 * (full controls) and techs (field-only controls). Everything wired to an
 * ownerOrOffice endpoint must be HIDDEN for techs — otherwise the tap appears
 * to succeed and silently rolls back (FORBIDDEN). Also guards the redacted-money
 * display: a server-redacted (null) rate must never render as $0.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TechJobModalContent } from "./tech-job-modal";
import { MODAL } from "@/lib/store/modal-ids";
import type { Job, Lead, Invoice } from "@/lib/store/types";

// ---------------------------------------------------------------------------
// Mocks: store + identity (role comes from v1.identity.me via useMe)
// ---------------------------------------------------------------------------

let mockJobs: Job[] = [];
let mockLeads: Lead[] = [];
let mockInvoices: Invoice[] = [];
let mockSeesPrice = true;
let mockRole: "owner" | "office" | "tech" | undefined = "owner";

const noop = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "tech-job", params: { jobId: "job-1" } }),
  useOpenModal: () => noop,
  useCloseModal: () => noop,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      jobs: mockJobs,
      leads: mockLeads,
      invoices: mockInvoices,
      toggles: { techSeesPrice: mockSeesPrice },
      setVisitStatus: noop,
      updateJob: noop,
      recordPayment: noop,
      addAddon: noop,
      setAddonStatus: noop,
      checkVerifyItem: noop,
      overrideVerifyItem: noop,
      uncheckVerifyItem: noop,
      addJobPhoto: noop,
    }),
}));

vi.mock("@/features/identity/hooks", () => ({
  useMe: () => ({ data: mockRole ? { role: mockRole } : undefined, isLoading: !mockRole }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    leadId: "lead-1",
    svc: "service",
    origin: "db",
    title: "Fix water heater",
    addr: "12 Oak St",
    phone: "",
    status: "scheduled",
    archived: false,
    lines: [],
    addons: [
      { id: 0, dbId: "a-db-1", d: "Extra shutoff valve", q: 1, r: 120, status: "proposed" },
    ],
    photos: [],
    notes: "",
    acts: [],
    visits: [{ id: "v1", date: "2026-07-12", techId: "tech-1", start: 9, dur: 2, status: "scheduled" }],
    checklist: {
      name: "Before you leave",
      items: [{ id: "i1", text: "Water back on", type: "check", required: true, position: 0 }],
    },
    ...overrides,
  };
}

const lead: Lead = {
  id: "lead-1",
  name: "Dana Alvarez",
  phone: "555-0101",
  stage: "Won",
} as unknown as Lead;

beforeEach(() => {
  mockJobs = [makeJob()];
  mockLeads = [lead];
  mockInvoices = [];
  mockSeesPrice = true;
  mockRole = "owner";
});

// ---------------------------------------------------------------------------
// Owner/office: full controls
// ---------------------------------------------------------------------------

describe("TechJobModalContent — owner/office", () => {
  it("shows Call/Text, visit step buttons, and add-on controls", () => {
    render(<TechJobModalContent />);
    expect(screen.getByText("Call")).toBeTruthy();
    expect(screen.getByText("Text")).toBeTruthy();
    expect(screen.getByText("On my way →")).toBeTruthy();
    expect(screen.getByText("✓ Mark done")).toBeTruthy();
    expect(screen.getByText(/Customer OK/)).toBeTruthy();
    expect(screen.getByPlaceholderText("extra work found…")).toBeTruthy();
  });

  it("shows the payment hero (charge on file) when the job is done", () => {
    mockJobs = [makeJob({ status: "done", visits: [{ id: "v1", date: "2026-07-12", techId: "t", start: 9, dur: 2, status: "done" }] })];
    mockInvoices = [
      { id: "inv-1", num: "INV-1", jobId: "job-1", leadId: "lead-1", cust: "Dana", phone: "", title: "x", lines: [], total: 300, depPaid: 0, payments: [], status: "sent", age: 0, archived: false } as unknown as Invoice,
    ];
    render(<TechJobModalContent />);
    expect(screen.getByText(/Take payment/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tech: office-only controls hidden (they call ownerOrOffice endpoints)
// ---------------------------------------------------------------------------

describe("TechJobModalContent — tech", () => {
  beforeEach(() => {
    mockRole = "tech";
  });

  it("hides Call/Text (myDay carries no customer phone — no dead buttons)", () => {
    render(<TechJobModalContent />);
    expect(screen.queryByText("Call")).toBeNull();
    expect(screen.queryByText("Text")).toBeNull();
  });

  it("hides visit status controls (v1.visits.setVisitStatus is ownerOrOffice)", () => {
    render(<TechJobModalContent />);
    expect(screen.queryByText("On my way →")).toBeNull();
    expect(screen.queryByText("✓ Mark done")).toBeNull();
    expect(screen.queryByText("↩ Reopen")).toBeNull();
  });

  it("hides add-on add + status controls but keeps the read-only found-work list", () => {
    render(<TechJobModalContent />);
    expect(screen.getByText("Extra shutoff valve")).toBeTruthy(); // read stays
    expect(screen.queryByText(/Customer OK/)).toBeNull();
    expect(screen.queryByPlaceholderText("extra work found…")).toBeNull();
  });

  it("keeps checklist check-off rows (v1.field.setVerifyAnswer is anyRole)", () => {
    render(<TechJobModalContent />);
    expect(screen.getByText("Water back on")).toBeTruthy();
  });

  it("hides the payment hero on a done job (charge/collect are office endpoints)", () => {
    mockJobs = [makeJob({ status: "done", visits: [{ id: "v1", date: "2026-07-12", techId: "t", start: 9, dur: 2, status: "done" }] })];
    mockInvoices = [
      { id: "inv-1", num: "INV-1", jobId: "job-1", leadId: "lead-1", cust: "Dana", phone: "", title: "x", lines: [], total: 300, depPaid: 0, payments: [], status: "sent", age: 0, archived: false } as unknown as Invoice,
    ];
    render(<TechJobModalContent />);
    expect(screen.queryByText(/Take payment/)).toBeNull();
    expect(screen.queryByText(/Charge/)).toBeNull();
    expect(screen.queryByText(/Send to the office/)).toBeNull();
  });

  it("never renders a server-redacted (null) rate as $0", () => {
    mockJobs = [
      makeJob({
        addons: [{ id: 0, dbId: "a-db-1", d: "Extra shutoff valve", q: 1, r: null, status: "proposed" }],
      }),
    ];
    render(<TechJobModalContent />);
    expect(screen.getByText("Extra shutoff valve")).toBeTruthy();
    expect(screen.queryByText(/\$0/)).toBeNull();
  });

  it("hides the empty found-work section for techs (no dead add form)", () => {
    mockJobs = [makeJob({ addons: [] })];
    render(<TechJobModalContent />);
    expect(screen.queryByText("Found work / add-ons")).toBeNull();
  });
});

// The modal id constant the mock's useActiveModal mirrors — keeps the mock honest.
it("MODAL.TECH_JOB matches the id the mock returns", () => {
  expect(MODAL.TECH_JOB).toBe("tech-job");
});
