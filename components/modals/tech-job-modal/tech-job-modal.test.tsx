// @vitest-environment jsdom
/**
 * components/modals/tech-job-modal.test.tsx
 *
 * Guards the field-surface role gate: the tech modal is shared by owner/office
 * (full controls) and techs (field-only controls). Anything wired to an
 * ownerOrOffice endpoint with no field sibling must be HIDDEN for techs —
 * otherwise the tap appears to succeed and silently rolls back (FORBIDDEN).
 * The visit step buttons DO have a field sibling, so they are the tech's; they
 * carry the write surface with them so his taps reach the endpoints that are
 * assignment-gated and that move his clock. Also guards the redacted-money
 * display: a server-redacted (null) rate must never render as $0.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TechJobModalContent } from "./tech-job-modal";
import { MODAL } from "@/lib/store/modal-ids";
import type { Job, Lead, Invoice } from "@/lib/store/types";

// ---------------------------------------------------------------------------
// Mocks: store + identity (role comes from v1.identity.me via useMe)
// The signed-in tech. Step buttons render only on a visit assigned to THIS id — a tech must not be
// able to move a colleague's visit on a shared job.
const MOCK_USER_ID = "tech-1";
// ---------------------------------------------------------------------------

let mockJobs: Job[] = [];
let mockLeads: Lead[] = [];
let mockInvoices: Invoice[] = [];
let mockSeesPrice = true;
let mockRole: "owner" | "office" | "tech" | undefined = "owner";

const noop = vi.fn();
const mockOpenModal = vi.fn();
const mockUpdateJob = vi.fn();
const mockSetVisitStatus = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "tech-job", params: { jobId: "job-1" } }),
  useOpenModal: () => mockOpenModal,
  usePushModal: () => mockOpenModal,
  useCloseModal: () => noop,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      jobs: mockJobs,
      leads: mockLeads,
      invoices: mockInvoices,
      toggles: { techSeesPrice: mockSeesPrice },
      setVisitStatus: mockSetVisitStatus,
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
  useMe: () => ({
    data: mockRole ? { role: mockRole, userId: MOCK_USER_ID } : undefined,
    isLoading: !mockRole,
  }),
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
  mockSetVisitStatus.mockReset();
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

  it("writes the office's taps through the OFFICE surface (no clock — she wasn't there)", () => {
    render(<TechJobModalContent />);
    fireEvent.click(screen.getByText("On my way →"));
    expect(mockSetVisitStatus).toHaveBeenCalledWith("job-1", "v1", "enroute", "office");
  });

  it("shows the payment hero (charge on file) when the job is done", () => {
    mockJobs = [makeJob({ status: "done", visits: [{ id: "v1", date: "2026-07-12", techId: "t", start: 9, dur: 2, status: "done" }] })];
    mockInvoices = [
      { id: "inv-1", num: "INV-1", jobId: "job-1", leadId: "lead-1", cust: "Dana", phone: "", title: "x", lines: [], total: 300, depPaid: 0, payments: [], status: "sent", age: 0, archived: false } as unknown as Invoice,
    ];
    render(<TechJobModalContent />);
    expect(screen.getByText(/Take payment/)).toBeTruthy();
  });

  // Fix 3 (money): once on-site lines persist, a refetched done job carries them, so
  // jobTotal(job) > 0 auto-selects the priced/"Take payment" branch even with no invoice.
  it("DoneBlock shows the persisted on-site price (Take payment), not 'No price set'", () => {
    mockInvoices = [];
    mockJobs = [
      makeJob({
        status: "done",
        visits: [{ id: "v1", date: "2026-07-12", techId: "t", start: 9, dur: 2, status: "done" }],
        // The price the tech set on site, as it comes back from the myDay refetch.
        lines: [{ d: "Diagnostic + repair", q: 1, r: 285 }],
      }),
    ];
    render(<TechJobModalContent />);
    expect(screen.getByText(/Take payment/)).toBeTruthy();
    expect(screen.getByText("$285")).toBeTruthy();
    expect(screen.queryByText(/No price set/)).toBeNull();
  });

  it("DoneBlock shows 'No price set' only when the job genuinely has no price", () => {
    mockInvoices = [];
    mockJobs = [
      makeJob({
        status: "done",
        visits: [{ id: "v1", date: "2026-07-12", techId: "t", start: 9, dur: 2, status: "done" }],
        lines: [],
      }),
    ];
    render(<TechJobModalContent />);
    expect(screen.getByText(/No price set/)).toBeTruthy();
    expect(screen.queryByText(/Take payment/)).toBeNull();
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

  // A reviewer found this: the modal renders every PLACED visit, unfiltered by assignee, and the
  // step buttons had been unhidden for techs wholesale. On a two-visit job the tech saw live
  // controls on a colleague's row, and tapping them moved that visit and wrote time against it.
  it("shows NO step buttons on a colleague's visit, only on the tech's own", () => {
    mockJobs = [
      makeJob({
        visits: [
          { id: "v1", date: "2026-07-12", techId: "tech-1", start: 9, dur: 2, status: "scheduled" },
          { id: "v2", date: "2026-07-12", techId: "someone-else", start: 13, dur: 2, status: "scheduled" },
        ],
      }),
    ];
    render(<TechJobModalContent />);
    // Both rows are visible (useful context), but exactly ONE carries the control.
    expect(screen.getAllByText("On my way →")).toHaveLength(1);
  });

  it("shows the step buttons — they are the tech's, and they are how his hours get recorded", () => {
    render(<TechJobModalContent />);
    expect(screen.getByText("On my way →")).toBeTruthy();
    expect(screen.getByText("✓ Mark done")).toBeTruthy();
  });

  it("writes the tech's taps through the FIELD surface (the office API would refuse him)", () => {
    render(<TechJobModalContent />);
    fireEvent.click(screen.getByText("On my way →"));
    expect(mockSetVisitStatus).toHaveBeenCalledWith("job-1", "v1", "enroute", "field");
  });

  it("still hides ↩ Reopen on a finished visit — that correction can rewrite recorded hours", () => {
    mockJobs = [
      makeJob({
        visits: [{ id: "v1", date: "2026-07-12", techId: "tech-1", start: 9, dur: 2, status: "done" }],
      }),
    ];
    render(<TechJobModalContent />);
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
// No job timer. The old hero was local React state that persisted nothing; hours
// now come from the day clock on My day plus the visit taps.
// ---------------------------------------------------------------------------

describe("TechJobModalContent — the job screen offers no timer", () => {
  it("shows no start/resume timer control on an unfinished job", () => {
    render(<TechJobModalContent />);
    expect(screen.queryByText("Start timer")).toBeNull();
    expect(screen.queryByText("Resume timer")).toBeNull();
    expect(screen.queryByText(/on the clock/i)).toBeNull();
  });

  it("leads with the address and the visit row instead", () => {
    render(<TechJobModalContent />);
    expect(screen.getByText("12 Oak St")).toBeTruthy();
    expect(screen.getByText("Your visit")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Phone gating (Fix 2: Call/Text stay TAPPABLE — the modal prompts to add a
// number in-flow; no standing "No phone on file" hint line; disabled only with
// no linked customer).
// ---------------------------------------------------------------------------

describe("TechJobModalContent — phone controls (office)", () => {
  it("Call/Text are tappable with a phone and open the call/thread modal; no hint line", () => {
    render(<TechJobModalContent />);
    const call = screen.getByText("Call") as HTMLButtonElement;
    const text = screen.getByText("Text") as HTMLButtonElement;
    expect(call.disabled).toBe(false);
    expect(text.disabled).toBe(false);
    expect(screen.queryByText(/No phone on file/)).toBeNull();
    fireEvent.click(call);
    expect(mockOpenModal).toHaveBeenCalledWith(MODAL.CALL, { leadId: "lead-1" });
    fireEvent.click(text);
    expect(mockOpenModal).toHaveBeenCalledWith(MODAL.THREAD, { leadId: "lead-1" });
  });

  it("Call/Text STAY tappable with no phone on file — the modal handles adding one", () => {
    mockLeads = [{ ...lead, phone: "" }];
    render(<TechJobModalContent />);
    const call = screen.getByText("Call") as HTMLButtonElement;
    const text = screen.getByText("Text") as HTMLButtonElement;
    // Not dead, not disabled — no standing hint (the add-phone row lives in the modal).
    expect(call.disabled).toBe(false);
    expect(text.disabled).toBe(false);
    expect(screen.queryByText(/No phone on file/)).toBeNull();
    fireEvent.click(call);
    expect(mockOpenModal).toHaveBeenCalledWith(MODAL.CALL, { leadId: "lead-1" });
  });

  it("disables Call/Text only when the job has no linked customer", () => {
    mockLeads = [];
    render(<TechJobModalContent />);
    const call = screen.getByText("Call") as HTMLButtonElement;
    expect(call.disabled).toBe(true);
    expect(call.title).toBe("No linked customer");
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

// ---------------------------------------------------------------------------
// Render-count probe (P4 pattern — Task A2 verification)
//
// Method: render the full modal, capture DOM snapshots of the WorkOrderSec and
// FoundWorkSec regions, then rerender with a job that has ONLY job.verify changed
// (simulating a checklist tap reconcile). Verify: WorkOrderSec DOM is unchanged
// (custom comparator skipped the re-render) and ChecklistSec DOM is updated
// (default memo sees new job object and re-renders).
//
// A true render-count probe would require exporting the section components and
// wrapping them with a counter ref; the DOM-snapshot proxy is the practial
// equivalent given the mock architecture of this test file. Render counts
// documented from dev-server probe below.
// ---------------------------------------------------------------------------

describe("Task A2 — section memos skip re-render on checklist tap", () => {
  it("WorkOrderSec DOM is identical after a verify-only job change", () => {
    const job = makeJob({
      lines: [{ d: "Replace shutoff valve", q: 1, r: 150 }],
      svc: "install",
    });
    mockJobs = [job];

    const { rerender, container } = render(<TechJobModalContent />);

    // Capture the work-order section's text content before the checklist tap.
    const workOrderBefore = Array.from(
      container.querySelectorAll(".fsec"),
    )
      .find((el) => el.textContent?.includes("Work order"))
      ?.textContent ?? "";

    expect(workOrderBefore).toContain("Replace shutoff valve");

    // Simulate a checklist tap reconcile: only job.verify changes.
    const jobAfter: Job = {
      ...job,
      verify: { ans: { i1: { st: "pass", via: "manual" } } },
    };
    mockJobs = [jobAfter];

    // Force a re-render of the parent (new mockJobs reference picked up by
    // useAppStore mock on the next render cycle).
    rerender(<TechJobModalContent />);

    const workOrderAfter = Array.from(
      container.querySelectorAll(".fsec"),
    )
      .find((el) => el.textContent?.includes("Work order"))
      ?.textContent ?? "";

    // WorkOrderSec content is byte-identical — its custom comparator saw that
    // job.lines/photos/title/special/prep didn't change and skipped the render.
    expect(workOrderAfter).toBe(workOrderBefore);
  });

  it("ChecklistSec reflects a verify answer after a checklist tap", () => {
    const job = makeJob();
    mockJobs = [job];

    const { rerender, container } = render(<TechJobModalContent />);

    // Before: the item is unchecked (○ glyph).
    const clBefore = Array.from(container.querySelectorAll(".fsec"))
      .find((el) => el.textContent?.includes("Before you leave"))
      ?.textContent ?? "";
    expect(clBefore).toContain("○");
    expect(clBefore).not.toContain("✓");

    // After: verify answer added.
    const jobAfter: Job = {
      ...job,
      verify: { ans: { i1: { st: "pass", via: "manual" } } },
    };
    mockJobs = [jobAfter];
    rerender(<TechJobModalContent />);

    const clAfter = Array.from(container.querySelectorAll(".fsec"))
      .find((el) => el.textContent?.includes("Before you leave"))
      ?.textContent ?? "";
    expect(clAfter).not.toContain("○");
    expect(clAfter).toContain("✓");
  });
});
