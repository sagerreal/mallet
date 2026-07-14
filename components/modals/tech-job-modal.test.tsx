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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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
const mockOpenModal = vi.fn();
const mockUpdateJob = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "tech-job", params: { jobId: "job-1" } }),
  useOpenModal: () => mockOpenModal,
  useCloseModal: () => noop,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      jobs: mockJobs,
      leads: mockLeads,
      invoices: mockInvoices,
      toggles: { techSeesPrice: mockSeesPrice },
      setVisitStatus: noop,
      updateJob: mockUpdateJob,
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

// Deterministic date stamp for the notes composer ("[Jul 13] …").
vi.mock("@/lib/clock", () => ({
  todayISO: () => "2026-07-13",
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
  mockOpenModal.mockClear();
  mockUpdateJob.mockReset();
  mockUpdateJob.mockResolvedValue({ ok: true });
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

// ---------------------------------------------------------------------------
// FieldTimer (Fix: pause must bank elapsed seconds, not epoch seconds)
// ---------------------------------------------------------------------------

describe("FieldTimer — pause banks elapsed time, not epoch seconds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T09:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("start → 90s → pause shows 1:30 (not epoch-scale)", () => {
    render(<TechJobModalContent />);
    fireEvent.click(screen.getByText("Start timer"));

    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    // Running clock shows the live elapsed.
    expect(screen.getByText("1:30")).toBeTruthy();

    // Pause = tap the running clock.
    fireEvent.click(screen.getByText(/on the clock/));
    expect(screen.getByText("1:30")).toBeTruthy();
    expect(screen.getByText("Resume timer")).toBeTruthy();
  });

  it("a second pause in a row (Stop after pause) stays stable", () => {
    render(<TechJobModalContent />);
    fireEvent.click(screen.getByText("Start timer"));
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    fireEvent.click(screen.getByText(/on the clock/)); // pause #1
    fireEvent.click(screen.getByText("Stop")); // pause #2 while already paused
    expect(screen.getByText("1:30")).toBeTruthy(); // no epoch seconds added
  });

  it("pause → resume → pause accumulates run segments only", () => {
    render(<TechJobModalContent />);
    fireEvent.click(screen.getByText("Start timer"));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    fireEvent.click(screen.getByText(/on the clock/)); // pause at 1:00

    act(() => {
      vi.advanceTimersByTime(600_000); // 10 min paused — must NOT count
    });
    fireEvent.click(screen.getByText("Resume timer"));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    fireEvent.click(screen.getByText(/on the clock/)); // pause at 1:30
    expect(screen.getByText("1:30")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Phone gating (Fix: phone-dependent controls disabled with no phone)
// ---------------------------------------------------------------------------

describe("TechJobModalContent — phone gating (office)", () => {
  it("enables Call/Text when the lead has a phone; no hint line", () => {
    render(<TechJobModalContent />);
    expect((screen.getByText("Call") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText("Text") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/No phone on file/)).toBeNull();
  });

  it("disables Call/Text with the add-a-phone title when the phone is the — placeholder", () => {
    mockLeads = [{ ...lead, phone: "—" }];
    render(<TechJobModalContent />);
    const call = screen.getByText("Call") as HTMLButtonElement;
    const text = screen.getByText("Text") as HTMLButtonElement;
    expect(call.disabled).toBe(true);
    expect(text.disabled).toBe(true);
    expect(call.title).toBe("Add a phone number first");
    expect(text.title).toBe("Add a phone number first");
  });

  it("shows the in-flow hint whose 'add one' opens the lead modal", () => {
    mockLeads = [{ ...lead, phone: "" }];
    render(<TechJobModalContent />);
    expect(screen.getByText(/No phone on file/)).toBeTruthy();
    fireEvent.click(screen.getByText("add one"));
    expect(mockOpenModal).toHaveBeenCalledWith(MODAL.LEAD, { leadId: "lead-1" });
  });

  it("keeps Call/Text disabled (no hint link) when the job has no linked lead", () => {
    mockLeads = [];
    render(<TechJobModalContent />);
    expect((screen.getByText("Call") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("add one")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Notes composer (Fix: the Notes section accepts input for the office)
// ---------------------------------------------------------------------------

describe("NoteFeed — office composer", () => {
  it("adds a stamped note through updateJob (empty notes → single stamped line)", async () => {
    render(<TechJobModalContent />);
    const input = screen.getByPlaceholderText("add a note…");
    fireEvent.change(input, { target: { value: "Gate code 4411" } });
    fireEvent.click(screen.getByLabelText("Add note"));
    await vi.waitFor(() => {
      expect(mockUpdateJob).toHaveBeenCalledWith("job-1", {
        notes: "[Jul 13] Gate code 4411",
      });
    });
    // input clears on success (after the awaited persist resolves)
    await vi.waitFor(() => {
      expect((input as HTMLInputElement).value).toBe("");
    });
  });

  it("appends to existing notes on its own stamped line", async () => {
    mockJobs = [makeJob({ notes: "Bring the tall ladder" })];
    render(<TechJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("add a note…"), {
      target: { value: "Left key under mat" },
    });
    fireEvent.click(screen.getByLabelText("Add note"));
    await vi.waitFor(() => {
      expect(mockUpdateJob).toHaveBeenCalledWith("job-1", {
        notes: "Bring the tall ladder\n[Jul 13] Left key under mat",
      });
    });
  });

  it("surfaces the save-failure copy when updateJob reports not-ok", async () => {
    mockUpdateJob.mockResolvedValue({ ok: false });
    render(<TechJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("add a note…"), {
      target: { value: "won't stick" },
    });
    fireEvent.click(screen.getByLabelText("Add note"));
    expect(await screen.findByText("Couldn't save the note — try again.")).toBeTruthy();
  });

  it("hides the composer once the job is done (server refuses edits on a complete job)", () => {
    mockJobs = [
      makeJob({
        status: "done",
        visits: [{ id: "v1", date: "2026-07-12", techId: "t", start: 9, dur: 2, status: "done" }],
      }),
    ];
    render(<TechJobModalContent />);
    expect(screen.queryByPlaceholderText("add a note…")).toBeNull();
    expect(screen.getByText("No notes yet.")).toBeTruthy();
  });
});

describe("NoteFeed — tech (read-only)", () => {
  beforeEach(() => {
    mockRole = "tech";
  });

  it("shows 'No notes yet.' and no composer when there are zero entries", () => {
    render(<TechJobModalContent />);
    expect(screen.getByText("No notes yet.")).toBeTruthy();
    expect(screen.queryByPlaceholderText("add a note…")).toBeNull();
    expect(screen.queryByLabelText("Add note")).toBeNull();
  });

  it("shows existing note entries without a composer", () => {
    mockJobs = [makeJob({ notes: "Customer prefers mornings" })];
    render(<TechJobModalContent />);
    expect(screen.getByText("Customer prefers mornings")).toBeTruthy();
    expect(screen.queryByText("No notes yet.")).toBeNull();
    expect(screen.queryByPlaceholderText("add a note…")).toBeNull();
  });
});

// The modal id constant the mock's useActiveModal mirrors — keeps the mock honest.
it("MODAL.TECH_JOB matches the id the mock returns", () => {
  expect(MODAL.TECH_JOB).toBe("tech-job");
});
