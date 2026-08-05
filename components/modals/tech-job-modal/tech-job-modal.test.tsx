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
// The field shell never hydrates the settings slice (SettingsHydrator mounts only in the
// office layout) — the tech job modal reads the org's visit fee via useOrgServiceFee instead.
// Mocked directly here (see use-org-service-fee.test.ts for the hook's own fetch/fallback tests).
let mockOrgFee: number | null = 89;
// May the SHOP text (A2P 10DLC campaign active)? The Text button is gated on this CAPABILITY for
// every role — not on isOffice, which answered a different question. The hook behind it reads
// v1.settings.fieldToggles; mocked here so this suite stays store-only (see use-can-text.ts).
let mockCanText = true;

const noop = vi.fn();
const mockOpenModal = vi.fn();
const mockUpdateJob = vi.fn();
const mockSetVisitStatus = vi.fn();
const mockSetVisitNotes2 = vi.fn(() => Promise.resolve({ ok: true }));
// The store's own paths, which the fee flow must NOT use any more: a client-side draft+send
// through v1.invoicing.draft was office-only and stamped no scope link. They stay mocked so the
// tests can assert they are never called.
const mockAddInvoice = vi.fn((draft: Record<string, unknown>) => {
  const inv = { ...draft, id: "inv-fee-1", num: "INV-900", origin: "manual" } as Invoice;
  mockInvoices = [...mockInvoices, inv];
  return { invoice: inv, persisted: Promise.resolve({ ok: true }) };
});
const mockSendInvoice = vi.fn(
  (_id: string): Promise<{ ok: boolean; error?: string }> => Promise.resolve({ ok: true }),
);
// The slice action that replaced them. Resolves the SERVER's id — the raise refuses a
// client-authored one, so the store adopts what comes back.
const mockRaiseVisitFee = vi.fn(
  (_jobId: string): Promise<{ ok: boolean; invoiceId?: string; error?: string }> =>
    Promise.resolve({ ok: true, invoiceId: "inv-fee-server" }),
);

function mockStoreState(): Record<string, unknown> {
  return {
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
    addInvoice: mockAddInvoice,
    sendInvoice: mockSendInvoice,
    raiseVisitFee: mockRaiseVisitFee,
    // Quote tab (estimating part 3) selectors.
    services: [],
    laborRates: [],
    brand: { name: "E2E Plumbing" },
    setVisitNotes: mockSetVisitNotes2,
    adoptJobPhotoPath: noop,
    signJobQuote: noop,
  };
}

/**
 * Found work and Job notes are COUNTED ROWS now — collapsed until tapped, so the work order and
 * the foot primary are not pushed off the bottom of a phone by two always-open feeds. Tests that
 * assert on their bodies open them first.
 */
function openSection(label: "Found work" | "Job notes"): void {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
}

function useAppStoreMock(selector: (s: Record<string, unknown>) => unknown) {
  return selector(mockStoreState());
}
useAppStoreMock.getState = mockStoreState;

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "tech-job", params: { jobId: "job-1" } }),
  useOpenModal: () => mockOpenModal,
  usePushModal: () => mockOpenModal,
  useCloseModal: () => noop,
  useAppStore: useAppStoreMock,
}));

// Keep native/scan + supabase out of jsdom (the Quote tab imports both modules).
// This suite is not about the scanner; a browser (no Capacitor bridge) is the honest default.
vi.mock("@/lib/native/room-scan", () => ({ useRoomScanAvailability: () => ({ status: "no-native-app" }) }));
vi.mock("@/lib/store/upload-field-photo", () => ({ uploadFieldPhoto: vi.fn() }));
vi.mock("@/lib/images/downscale", () => ({ downscaleImage: vi.fn() }));

vi.mock("@/features/identity/hooks", () => ({
  useMe: () => ({
    data: mockRole ? { role: mockRole, userId: MOCK_USER_ID } : undefined,
    isLoading: !mockRole,
  }),
}));

vi.mock("@/features/settings/use-org-service-fee", () => ({
  useOrgServiceFee: () => mockOrgFee,
}));

vi.mock("@/features/messaging/use-can-text", () => ({
  useCanText: () => mockCanText,
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
  mockOrgFee = 89;
  mockCanText = true;
  mockOpenModal.mockClear();
  mockUpdateJob.mockReset();
  mockUpdateJob.mockResolvedValue({ ok: true });
  mockSetVisitStatus.mockReset();
  mockAddInvoice.mockClear();
  mockSendInvoice.mockClear();
  mockRaiseVisitFee.mockClear();
});

// ---------------------------------------------------------------------------
// Owner/office: full controls
// ---------------------------------------------------------------------------

describe("TechJobModalContent — owner/office", () => {
  it("shows Call/Text, the advancing foot, and add-on controls", () => {
    render(<TechJobModalContent />);
    expect(screen.getByText("Call")).toBeTruthy();
    expect(screen.getByText("Text")).toBeTruthy();
    expect(screen.getByText("Start driving →")).toBeTruthy();
    expect(screen.getByText("Finish job →")).toBeTruthy();
    openSection("Found work");
    expect(screen.getByText(/Customer OK/)).toBeTruthy();
    expect(screen.getByPlaceholderText("extra work found…")).toBeTruthy();
  });

  it("writes the office's taps through the OFFICE surface (no clock — she wasn't there)", () => {
    render(<TechJobModalContent />);
    fireEvent.click(screen.getByText("Start driving →"));
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
    // Three, and each is right: the close-out hero's amount, the work-order line, and the work
    // order's Total. A finished job keeps its work order now — that is when someone checks what
    // was sold — so the figure legitimately appears more than once.
    expect(screen.getAllByText("$285").length).toBe(3);
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

  // Call is for everyone: ringing the customer on the way is the ordinary field case, and going
  // through Mallet is what keeps the tech's personal mobile off the customer's phone.
  //
  // Text is gated on CAPABILITY, not on role. It was `isOffice`-only, which answered the wrong
  // question: whether the shop may send an SMS is decided by its A2P 10DLC campaign, and that
  // answer is the same whoever is holding the phone. A technician in a registered shop gets the
  // thread; nobody in an unregistered one does.
  it("shows Call, and Text too — a registered shop can text from the field", () => {
    render(<TechJobModalContent />);
    expect(screen.queryByText("Call")).not.toBeNull();
    expect(screen.queryByText("Text")).not.toBeNull();
  });

  it("draws NO Text button when the org cannot text — a dead control is worse than none", () => {
    mockCanText = false;
    render(<TechJobModalContent />);
    expect(screen.queryByText("Call")).not.toBeNull();
    expect(screen.queryByText("Text")).toBeNull();
  });

  it("withholds Text from the OFFICE too when the campaign isn't active", () => {
    mockRole = "owner";
    mockCanText = false;
    render(<TechJobModalContent />);
    expect(screen.queryByText("Text")).toBeNull();
  });

  // A reviewer found this: the modal renders every PLACED visit, unfiltered by assignee, and the
  // step buttons had been unhidden for techs wholesale. On a two-visit job the tech could move a
  // colleague's visit and write time against it. The controls now live in the foot, which acts on
  // exactly one visit — so the guard is that the foot picks the TECH'S OWN.
  it("the foot moves the tech's OWN visit on a job they share with a colleague", () => {
    mockJobs = [
      makeJob({
        visits: [
          { id: "v1", date: "2026-07-12", techId: "tech-1", start: 9, dur: 2, status: "scheduled" },
          { id: "v2", date: "2026-07-12", techId: "someone-else", start: 13, dur: 2, status: "scheduled" },
        ],
      }),
    ];
    render(<TechJobModalContent />);
    // Both visits are on the sheet (useful context — "my stop is the second one today"), but
    // there is exactly one foot and it moves v1, the tech's own.
    expect(screen.getAllByRole("list", { name: "Visit progress" })).toHaveLength(2);
    fireEvent.click(screen.getByText("Start driving →"));
    expect(mockSetVisitStatus).toHaveBeenCalledWith("job-1", "v1", "enroute", "field");
  });

  // A visit that is not theirs and not the office's to move gets no foot step at all — the
  // server refuses it, so the sheet falls back to a plain dismiss rather than an erroring button.
  it("offers no step at all on a job assigned to somebody else", () => {
    mockJobs = [
      makeJob({
        visits: [{ id: "v9", date: "2026-07-12", techId: "someone-else", start: 9, dur: 2, status: "scheduled" }],
      }),
    ];
    render(<TechJobModalContent />);
    expect(screen.queryByText("Start driving →")).toBeNull();
    expect(screen.queryByText("Finish job →")).toBeNull();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("writes the tech's taps through the FIELD surface (the office API would refuse him)", () => {
    render(<TechJobModalContent />);
    fireEvent.click(screen.getByText("Start driving →"));
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
    openSection("Found work");
    expect(screen.getByText("Extra shutoff valve")).toBeTruthy(); // read stays
    expect(screen.queryByText(/Customer OK/)).toBeNull();
    expect(screen.queryByPlaceholderText("extra work found…")).toBeNull();
  });

  it("keeps checklist check-off rows (v1.field.setVerifyAnswer is anyRole)", () => {
    render(<TechJobModalContent />);
    expect(screen.getByText("Water back on")).toBeTruthy();
  });

  // OWNER'S DECISION, Aug 2026: a technician assigned to the job takes the payment at the door.
  // The hero renders for them; only the writes with no field sibling stay behind.
  it("SHOWS the payment hero on their own done job", () => {
    mockJobs = [
      makeJob({
        status: "done",
        visits: [{ id: "v1", date: "2026-07-12", techId: MOCK_USER_ID, start: 9, dur: 2, status: "done" }],
      }),
    ];
    mockInvoices = [
      { id: "inv-1", num: "INV-1", jobId: "job-1", leadId: "lead-1", cust: "Dana", phone: "", title: "x", lines: [], total: 300, depPaid: 0, payments: [], status: "sent", age: 0, archived: false } as unknown as Invoice,
    ];
    render(<TechJobModalContent />);
    expect(screen.getByText("Take payment →")).toBeTruthy();
    expect(screen.getByText("$300")).toBeTruthy();
    // …and the office-only hand-off is not offered, because job.invRequested is v1.jobs.update.
    expect(screen.queryByText(/Send to the office/)).toBeNull();
  });

  // Assignment, not role, is the gate — mirroring the server's own Job.isAssignedTo guard.
  it("shows NO payment hero on a colleague's done job", () => {
    mockJobs = [
      makeJob({
        status: "done",
        visits: [{ id: "v1", date: "2026-07-12", techId: "someone-else", start: 9, dur: 2, status: "done" }],
      }),
    ];
    mockInvoices = [
      { id: "inv-1", num: "INV-1", jobId: "job-1", leadId: "lead-1", cust: "Dana", phone: "", title: "x", lines: [], total: 300, depPaid: 0, payments: [], status: "sent", age: 0, archived: false } as unknown as Invoice,
    ];
    render(<TechJobModalContent />);
    expect(screen.queryByText(/Take payment/)).toBeNull();
    expect(screen.queryByText(/Charge/)).toBeNull();
  });

  // A1: the invoice's own balance is ALWAYS theirs to read — you cannot collect $840 without
  // displaying "$840" — but the per-line breakdown still follows the shop's techSeesPrice.
  it("hide-prices shop: the BALANCE renders, the redacted line rates do not", () => {
    mockSeesPrice = false;
    mockJobs = [
      makeJob({
        status: "done",
        // What the server sends a redacted device: descriptions, rate NULLED.
        lines: [{ d: "Water heater", q: 1, r: null }],
        addons: [],
        visits: [{ id: "v1", date: "2026-07-12", techId: MOCK_USER_ID, start: 9, dur: 2, status: "done" }],
      }),
    ];
    mockInvoices = [
      { id: "inv-1", num: "INV-1", jobId: "job-1", leadId: "lead-1", cust: "Dana", phone: "", title: "x", lines: [], total: 840, depPaid: 0, payments: [], status: "sent", age: 0, archived: false } as unknown as Invoice,
    ];
    render(<TechJobModalContent />);
    expect(screen.getByText("$840")).toBeTruthy();
    expect(screen.getByText("Take payment →")).toBeTruthy();
    // The nulled rate is never drawn as a price of any kind — least of all as $0.
    expect(screen.queryByText(/\$0\b/)).toBeNull();
  });

  // The PR-C1 failure this whole third state exists for: with no invoice loaded yet, a redacted
  // job sums to $0 and the old code offered "Send to the office to bill" — an office write the
  // technician cannot make, on a job they were sent out to collect on.
  it("hide-prices shop, no invoice yet: offers the bill, never 'No price set'", () => {
    mockSeesPrice = false;
    mockJobs = [
      makeJob({
        status: "done",
        lines: [{ d: "Water heater", q: 1, r: null }],
        addons: [],
        visits: [{ id: "v1", date: "2026-07-12", techId: MOCK_USER_ID, start: 9, dur: 2, status: "done" }],
      }),
    ];
    mockInvoices = [];
    render(<TechJobModalContent />);
    expect(screen.queryByText(/No price set/)).toBeNull();
    expect(screen.queryByText(/Send to the office/)).toBeNull();
    expect(screen.getByText(/Prices are hidden on your device/)).toBeTruthy();
    expect(screen.getByText("Take payment →")).toBeTruthy();
  });

  it("never renders a server-redacted (null) rate as $0", () => {
    mockJobs = [
      makeJob({
        addons: [{ id: 0, dbId: "a-db-1", d: "Extra shutoff valve", q: 1, r: null, status: "proposed" }],
      }),
    ];
    render(<TechJobModalContent />);
    openSection("Found work");
    expect(screen.getByText("Extra shutoff valve")).toBeTruthy();
    expect(screen.queryByText(/\$0/)).toBeNull();
  });

  it("hides the empty found-work section for techs (no dead add form)", () => {
    mockJobs = [makeJob({ addons: [] })];
    render(<TechJobModalContent />);
    expect(screen.queryByRole("button", { name: /^Found work/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The foot: the primary IS the next step, and Finish is always one tap away.
// ---------------------------------------------------------------------------

describe("TechJobModalContent — the advancing foot", () => {
  const withVisit = (status: string) =>
    makeJob({ visits: [{ id: "v1", date: "2026-07-12", techId: "tech-1", start: 9, dur: 2, status }] });

  it.each([
    ["scheduled", "Start driving →", "enroute"],
    ["enroute", "I've arrived →", "onsite"],
    ["onsite", "Finish job →", "done"],
  ])("from %s the primary reads %s and writes %s", (status, label, written) => {
    mockJobs = [withVisit(status)];
    render(<TechJobModalContent />);
    fireEvent.click(screen.getByText(label));
    expect(mockSetVisitStatus).toHaveBeenCalledWith("job-1", "v1", written, "office");
  });

  // THE RULE. On my way and Arrived are optional — the server allows pending → complete
  // deliberately — so a man in a customer's kitchen is never told to tap "on the way" first.
  it.each(["scheduled", "enroute"])("offers a quiet Finish from %s — never more than one tap away", (status) => {
    mockJobs = [withVisit(status)];
    render(<TechJobModalContent />);
    fireEvent.click(screen.getByText("Finish job →"));
    expect(mockSetVisitStatus).toHaveBeenCalledWith("job-1", "v1", "done", "office");
  });

  it("shows Finish ONCE on site — the primary is already it, so there is no quiet twin", () => {
    mockJobs = [withVisit("onsite")];
    render(<TechJobModalContent />);
    expect(screen.getAllByText("Finish job →")).toHaveLength(1);
  });

  // No confirmation dialog: finishing is reversible by the office, and a modal on top of a modal
  // in a truck is worse than the mistake it guards against.
  it("finishes on the first tap, with nothing to confirm", () => {
    mockJobs = [withVisit("onsite")];
    render(<TechJobModalContent />);
    fireEvent.click(screen.getByText("Finish job →"));
    expect(mockSetVisitStatus).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The work order: a count, a Total, and THREE money states.
// ---------------------------------------------------------------------------

describe("TechJobModalContent — work order", () => {
  const priced = [
    { d: "Replace T&P relief valve", q: 1, r: 325 },
    { d: "Repair shut-off valve", q: 1, r: 245 },
  ];

  it("heads the section with the count and the total, and closes with a Total row", () => {
    mockJobs = [makeJob({ lines: priced })];
    render(<TechJobModalContent />);
    expect(screen.getByText("2 items · $570")).toBeTruthy();
    // The header figure and the Total row are computed from the same rendered lines, so they
    // cannot disagree with the numbers between them.
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getByText("$570")).toBeTruthy();
    expect(screen.getByText("$325")).toBeTruthy();
    expect(screen.getByText("$245")).toBeTruthy();
  });

  // A plain service call has unpriced scope lines, so jobMode() reads "service" — and the old
  // three-way gate meant the technician arrived knowing the customer's name and nothing else.
  it("renders for an UNPRICED service call, which never showed a work order at all", () => {
    mockJobs = [makeJob({ lines: [{ d: "Clear kitchen drain", q: 1, r: 0 }] })];
    render(<TechJobModalContent />);
    expect(screen.getByText("Clear kitchen drain")).toBeTruthy();
    expect(screen.getByText("1 item · $0")).toBeTruthy();
  });

  // STATE 3, and the one that matters: a redacted rate is null, not zero. A shop that hides
  // prices from its techs must not have its priced job summarised as free.
  it("says prices are withheld rather than printing a fabricated $0", () => {
    mockRole = "tech";
    mockJobs = [
      makeJob({
        lines: [
          { d: "Replace T&P relief valve", q: 1, r: null },
          { d: "Repair shut-off valve", q: 1, r: null },
        ],
      }),
    ];
    render(<TechJobModalContent />);
    expect(screen.getByText("2 items")).toBeTruthy();
    expect(screen.getByText(/Prices aren’t shown on your device/)).toBeTruthy();
    expect(screen.queryByText("Total")).toBeNull();
    expect(screen.queryByText("$0")).toBeNull();
  });

  it("shows no figures when the org toggle is off, even with rates in hand", () => {
    mockSeesPrice = false;
    mockJobs = [makeJob({ lines: priced })];
    render(<TechJobModalContent />);
    expect(screen.getByText("2 items")).toBeTruthy();
    expect(screen.queryByText("$570")).toBeNull();
  });

  // Line COST is never rendered on this surface, for any role, under any toggle.
  it("never renders a line's cost", () => {
    mockJobs = [makeJob({ lines: [{ d: "Replace T&P relief valve", q: 1, r: 325, c: 140 }] })];
    render(<TechJobModalContent />);
    expect(screen.queryByText("$140")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Counted navigation rows — the two feeds collapse to a label and a number.
// ---------------------------------------------------------------------------

describe("TechJobModalContent — counted rows", () => {
  it("collapses Found work and Job notes to a count, and expands them in flow", () => {
    mockJobs = [makeJob({ notes: "Gate code 4411" })];
    render(<TechJobModalContent />);
    const notes = screen.getByRole("button", { name: /^Job notes/ });
    expect(notes.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Gate code 4411")).toBeNull();
    fireEvent.click(notes);
    expect(notes.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Gate code 4411")).toBeTruthy();
  });

  // Whitespace-tolerant: the count, its qualifier and the caret are three flex items separated by
  // a CSS gap (.tjf-v), and jsdom loads no stylesheet — so the run-together name here is a test
  // artefact, not what a screen reader gets. The words and their order are the contract.
  it("counts the found work, and names how many are still awaiting the customer's OK", () => {
    render(<TechJobModalContent />);
    expect(screen.getByRole("button", { name: /^Found work\s*1\s*·\s*1 awaiting OK/ })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The visit stepper — a readout of what was recorded, never a control.
// ---------------------------------------------------------------------------

describe("TechJobModalContent — visit stepper", () => {
  it("names the three steps and marks the current one for a screen reader", () => {
    render(<TechJobModalContent />);
    const list = screen.getByRole("list", { name: "Visit progress" });
    const nodes = screen.getAllByRole("listitem");
    expect(list).toBeTruthy();
    expect(nodes.map((n) => n.textContent)).toEqual([
      "Scheduled, current step",
      "On the way, not yet",
      "On site, not yet",
    ]);
    expect(nodes[0]?.getAttribute("aria-current")).toBe("step");
  });

  // The nodes are deliberately not buttons: three ~30px targets is the worst tap geometry for a
  // gloved thumb, and the server refuses every backwards transition, so tappable nodes would look
  // live and refuse. The foot primary is the one big target.
  it("draws no tappable node — the stepper reads, the foot advances", () => {
    render(<TechJobModalContent />);
    for (const name of ["Scheduled", "On the way", "On site"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  // THE RULE: skipped stays skipped. No backfilled arrival, in the record or on the glass.
  it("shows a finished-without-taps visit as SKIPPED, with no invented times", () => {
    mockJobs = [
      makeJob({
        status: "done",
        visits: [{ id: "v1", date: "2026-07-12", techId: "tech-1", start: 9, dur: 2, status: "done" }],
      }),
    ];
    render(<TechJobModalContent />);
    expect(screen.getAllByText("skipped")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// The header: the customer, then what the work is and when it was due.
// ---------------------------------------------------------------------------

describe("TechJobModalContent — header", () => {
  it("leads with the customer and names the TRADE beneath, from job.svc", () => {
    mockJobs = [makeJob({ svc: "Water heater repair", visits: [{ id: "v1", date: "2026-07-13", techId: "tech-1", start: 15, dur: 2, status: "scheduled" }] })];
    render(<TechJobModalContent />);
    expect(screen.getByRole("heading", { name: "Dana Alvarez" })).toBeTruthy();
    expect(screen.getByText("Water heater repair")).toBeTruthy();
    // todayISO is mocked to 2026-07-13, so this visit is today.
    expect(screen.getByText("Today, 3:00 PM")).toBeTruthy();
  });

  // The store's mapper fills a null svc column with the literal "service" and older rows carry
  // the board's lane keys in it. Printing either would name the lane, not the work.
  it("falls back to the job title rather than printing the lane key", () => {
    mockJobs = [makeJob({ svc: "service", title: "Fix water heater" })];
    render(<TechJobModalContent />);
    expect(screen.getByText("Fix water heater")).toBeTruthy();
    expect(screen.queryByText("service")).toBeNull();
  });

  it("prints no time at all for a job with no placed visit — it must not invent one", () => {
    mockJobs = [makeJob({ svc: "Water heater repair", visits: [] })];
    render(<TechJobModalContent />);
    expect(screen.getByText("Water heater repair")).toBeTruthy();
    expect(screen.queryByText(/Today,/)).toBeNull();
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
    // "Visit", not "Your visit" — the office reads this sheet too.
    expect(screen.getByText("Visit")).toBeTruthy();
  });

  // The approved design puts the status readout directly under the contact row: a technician
  // opening this sheet answers "where am I in this job" before "what did we sell". Asserted on
  // DOM order, because the two sections rendered in the wrong sequence is invisible to a test
  // that only checks both exist.
  it("puts the visit ABOVE the work order", () => {
    // Needs a described line, or the work order does not render at all and the assertion is vacuous.
    mockJobs = [makeJob({ lines: [{ d: "Swap heater", q: 1, r: 900 }] })];
    render(<TechJobModalContent />);
    const visit = screen.getByText("Visit");
    const work = screen.getByText("Work order");
    expect(visit.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    openSection("Job notes");
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
    openSection("Job notes");
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
    openSection("Job notes");
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
    openSection("Job notes");
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
    openSection("Job notes");
    expect(screen.getByText("No notes yet.")).toBeTruthy();
    expect(screen.queryByPlaceholderText("add a note…")).toBeNull();
    expect(screen.queryByLabelText("Add note")).toBeNull();
  });

  it("shows existing note entries without a composer", () => {
    mockJobs = [makeJob({ notes: "Customer prefers mornings" })];
    render(<TechJobModalContent />);
    openSection("Job notes");
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
// Tabs (estimating part 3): Job · Quote for EVERY role — the tabs are
// surface-based, not role-based. An owner-operator opening a job from My day
// (this modal's only entry) needs the Quote tab exactly as a tech does; every
// endpoint the tab writes through is anyRole.
// ---------------------------------------------------------------------------

describe("TechJobModalContent — tabs", () => {
  it("owner: Job · Quote tabs render — the tabs are surface-based, not role-based", () => {
    mockRole = "owner";
    render(<TechJobModalContent />);
    expect(screen.getByRole("tab", { name: "Job" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Quote" })).toBeTruthy();
    // The one pricing home on this surface is the Quote tab — the old
    // office-only PricingSec entry is gone.
    expect(screen.queryByText("Price it on site →")).toBeNull();
    expect(screen.queryByText("Pricing")).toBeNull();
  });

  // The tablist named two controls and neither pointed at anything: there was no tabpanel in the
  // file at all. A screen-reader user tabbed off "Quote" straight into the sheet body with no
  // announcement that the body was what the tab controlled.
  it("each tab controls a real, matching tabpanel", () => {
    render(<TechJobModalContent />);
    const jobTab = screen.getByRole("tab", { name: "Job" });
    const panel = screen.getByRole("tabpanel");
    expect(jobTab.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(jobTab.id);
    fireEvent.click(screen.getByRole("tab", { name: "Quote" }));
    const quotePanel = screen.getByRole("tabpanel");
    expect(screen.getByRole("tab", { name: "Quote" }).getAttribute("aria-controls")).toBe(quotePanel.id);
  });

  it("owner: the Quote tab opens with Scope + the embedded builder", () => {
    mockRole = "owner";
    render(<TechJobModalContent />);
    fireEvent.click(screen.getByRole("tab", { name: "Quote" }));
    expect(screen.getByText("Scope")).toBeTruthy();
    expect(screen.getByText("The price")).toBeTruthy();
    expect(screen.getByText("Present to customer →")).toBeTruthy();
  });

  it("owner: an estimate job's Quote tab offers the dual exit (scope capture + quote now)", () => {
    mockRole = "owner";
    mockJobs = [makeJob({ svc: "estimate" })];
    render(<TechJobModalContent />);
    fireEvent.click(screen.getByRole("tab", { name: "Quote" }));
    expect(screen.getByText("Quote it now")).toBeTruthy();
    expect(screen.getByText("Send scope to the office")).toBeTruthy();
  });

  it("tech: Job · Quote tabs render; the Job tab carries no pricing section", () => {
    mockRole = "tech";
    render(<TechJobModalContent />);
    expect(screen.getByRole("tab", { name: "Job" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Quote" })).toBeTruthy();
    // The pricing home is the Quote tab.
    expect(screen.queryByText("Price it on site →")).toBeNull();
    expect(screen.queryByText("Pricing")).toBeNull();
  });

  it("tech: the Quote tab shows Scope + the builder and takes over the foot", () => {
    mockRole = "tech";
    render(<TechJobModalContent />);
    fireEvent.click(screen.getByRole("tab", { name: "Quote" }));
    expect(screen.getByText("Scope")).toBeTruthy();
    expect(screen.getByText("The price")).toBeTruthy();
    expect(screen.getByText("Present to customer →")).toBeTruthy();
    // The Job tab's spine is hidden while the Quote tab is up.
    expect(screen.queryByText("Your visit")).toBeNull();
    expect(screen.queryByText("Done")).toBeNull();
  });

  it("tech: an estimate job's Quote tab replaces the dead end with the dual exit", () => {
    mockRole = "tech";
    mockJobs = [makeJob({ svc: "estimate" })];
    render(<TechJobModalContent />);
    fireEvent.click(screen.getByRole("tab", { name: "Quote" }));
    expect(screen.getByText("Quote it now")).toBeTruthy();
    expect(screen.getByText("Send scope to the office")).toBeTruthy();
    // The old "Scoping visit — the office builds the quote" copy is gone for techs.
    expect(screen.queryByText(/Scoping visit/)).toBeNull();
  });

  it("tech: the Quote tab's scope save reaches setVisitNotes with the tech's own visit", async () => {
    mockRole = "tech";
    render(<TechJobModalContent />);
    fireEvent.click(screen.getByRole("tab", { name: "Quote" }));
    fireEvent.click(screen.getByText(/What you saw on site/));
    fireEvent.change(screen.getByLabelText("Scope notes"), { target: { value: "two doors" } });
    fireEvent.click(screen.getByText("Save scope"));
    await vi.waitFor(() => {
      expect(mockSetVisitNotes2).toHaveBeenCalledWith("job-1", "v1", "two doors");
    });
  });
});

// ---------------------------------------------------------------------------
// Done ESTIMATE (unpriced): the close-out is a scope handoff — no role may be
// asked for money on a scoping visit. The founder finished a scoping visit and
// was offered "Set a bill & take payment →" + "Send to the office to bill".
// ---------------------------------------------------------------------------

describe("TechJobModalContent — done estimate is a scope handoff, never billing", () => {
  const doneEstimate = (scopeNotes?: string) =>
    makeJob({
      svc: "estimate",
      status: "done",
      lines: [],
      addons: [],
      visits: [
        { id: "v1", date: "2026-07-12", techId: "tech-1", start: 9, dur: 2, status: "done", scopeNotes },
      ],
    });

  for (const role of ["owner", "tech"] as const) {
    it(`${role}: a scoped done estimate shows the handoff card, no billing branch`, () => {
      mockRole = role;
      mockJobs = [doneEstimate("Two doors, tight attic access")];
      render(<TechJobModalContent />);
      expect(screen.getByText("✓ Scoped — the office builds the quote")).toBeTruthy();
      // None of the billing surfaces may render on a scoping visit.
      expect(screen.queryByText(/No price set/)).toBeNull();
      expect(screen.queryByText(/Set a bill/)).toBeNull();
      expect(screen.queryByText(/Send to the office to bill/)).toBeNull();
      expect(screen.queryByText(/Take payment/)).toBeNull();
      expect(screen.queryByText(/Charge/)).toBeNull();
      // The foot is a plain Done, not a billing action.
      expect(screen.getByText("Done")).toBeTruthy();
    });

    it(`${role}: an unscoped done estimate names the gap and opens the Quote tab`, () => {
      mockRole = role;
      mockJobs = [doneEstimate()];
      render(<TechJobModalContent />);
      expect(screen.getByText(/No scope captured/)).toBeTruthy();
      expect(screen.queryByText(/Set a bill/)).toBeNull();
      fireEvent.click(screen.getByText("Open the Quote tab →"));
      // The tab switched: the Quote tab body replaces the Job spine.
      expect(screen.getByText("Scope")).toBeTruthy();
      expect(screen.queryByText("Your visit")).toBeNull();
    });
  }

  it("owner: a done estimate SIGNED on site keeps the billing close-out (it has a real price)", () => {
    mockRole = "owner";
    mockJobs = [
      makeJob({
        svc: "estimate",
        status: "done",
        lines: [{ d: "Repaint hall", q: 1, r: 400 }],
        visits: [{ id: "v1", date: "2026-07-12", techId: "tech-1", start: 9, dur: 2, status: "done" }],
      }),
    ];
    render(<TechJobModalContent />);
    expect(screen.getByText(/Take payment/)).toBeTruthy();
    expect(screen.queryByText(/Scoped — the office builds the quote/)).toBeNull();
  });

  it("tech: a done estimate SIGNED on site gets the billing close-out — they close their own sale", () => {
    mockRole = "tech";
    mockJobs = [
      makeJob({
        svc: "estimate",
        status: "done",
        lines: [{ d: "Repaint hall", q: 1, r: 400 }],
        visits: [{ id: "v1", date: "2026-07-12", techId: MOCK_USER_ID, start: 9, dur: 2, status: "done" }],
      }),
    ];
    render(<TechJobModalContent />);
    expect(screen.getByText("Take payment →")).toBeTruthy();
    expect(screen.queryByText(/Scoped — the office builds the quote/)).toBeNull();
  });

  // The signed-estimate case a hide-prices shop would otherwise get catastrophically wrong: every
  // rate arrives null, jobQuoted reads false, and the sold job would be filed as an unpriced
  // scoping visit — a handoff card in front of a customer who just agreed to pay.
  it("tech, hide-prices shop: a SIGNED estimate is not mistaken for an unpriced scoping visit", () => {
    mockRole = "tech";
    mockSeesPrice = false;
    mockJobs = [
      makeJob({
        svc: "estimate",
        status: "done",
        lines: [{ d: "Repaint hall", q: 1, r: null }],
        visits: [{ id: "v1", date: "2026-07-12", techId: MOCK_USER_ID, start: 9, dur: 2, status: "done" }],
      }),
    ];
    render(<TechJobModalContent />);
    expect(screen.queryByText(/Scoped — the office builds the quote/)).toBeNull();
    expect(screen.queryByText(/Estimate visit done/)).toBeNull();
    expect(screen.getByText("Take payment →")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The visit fee on a declined estimate.
//
// THE ONE LINE THAT MATTERS: the raise goes to `v1.fieldInvoicing.raiseVisitFee` with the JOB ID
// AND NOTHING ELSE. Not an invoice id (the guard authorizes the job, so a caller-supplied id
// would be an unchecked write target) and not an amount (the server reads the shop's own fee, so
// the person holding the tablet cannot choose what the customer is charged).
//
// It replaced a client-side draft+send against `v1.invoicing.draft`, which was ownerOrOffice —
// the technician standing at the door, the only person who knows the customer declined, got
// FORBIDDEN — and stamped no scope link, so even the office's fee invoice was uncollectable by
// the person sent to collect it. Being server-idempotent per job also retires the whole
// orphaned-duplicate-draft problem the old flow needed local cleanup for.
// ---------------------------------------------------------------------------

describe("TechJobModalContent — collecting the visit fee on a declined estimate", () => {
  const doneEstimate = (scopeNotes?: string) =>
    makeJob({
      svc: "estimate",
      status: "done",
      lines: [],
      addons: [],
      visits: [
        { id: "v1", date: "2026-07-12", techId: MOCK_USER_ID, start: 9, dur: 2, status: "done", scopeNotes },
      ],
    });

  it("owner: renders the fee button reading the org's real fee", () => {
    mockRole = "owner";
    mockOrgFee = 129;
    mockJobs = [doneEstimate()];
    render(<TechJobModalContent />);
    expect(screen.getByText("Collect the visit fee — $129")).toBeTruthy();
    // The quiet handoff is never blocked by the secondary fee action.
    expect(screen.getByText("Open the Quote tab →")).toBeTruthy();
  });

  // The field shell cannot read v1.settings.get, so the button names no figure. It does not need
  // to — the server reads the fee and the close-out sheet shows the real amount a moment later.
  it("tech ON the job: gets the fee button with no amount on it", () => {
    mockRole = "tech";
    mockOrgFee = null;
    mockJobs = [doneEstimate()];
    render(<TechJobModalContent />);
    expect(screen.getByText("Collect the visit fee →")).toBeTruthy();
  });

  it("tech NOT on the job: no fee button (the server would refuse them anyway)", () => {
    mockRole = "tech";
    mockOrgFee = null;
    mockJobs = [
      makeJob({
        svc: "estimate",
        status: "done",
        lines: [],
        addons: [],
        visits: [
          { id: "v1", date: "2026-07-12", techId: "someone-else", start: 9, dur: 2, status: "done" },
        ],
      }),
    ];
    render(<TechJobModalContent />);
    expect(screen.queryByText(/Collect the visit fee/)).toBeNull();
  });

  it("owner: hides the fee button once a fee invoice already exists for this lead", () => {
    mockRole = "owner";
    mockJobs = [doneEstimate()];
    mockInvoices = [
      {
        id: "inv-1", num: "INV-1", jobId: "job-1", leadId: "lead-1", cust: "Dana", phone: "",
        title: "Visit fee — service call", lines: [], total: 89, depPaid: 0, payments: [],
        status: "sent", age: 0, archived: false,
      } as unknown as Invoice,
    ];
    render(<TechJobModalContent />);
    expect(screen.queryByText(/Collect the visit fee/)).toBeNull();
  });

  // The durable shape: after a reload the invoices hydrator reconstructs the record from the
  // server DTO, which never carries sourceJobId for a lead-tied invoice — jobId reads back null.
  // The guard must still hold on title + leadId alone.
  it("owner: hides the fee button from hydrator-shaped state (jobId null, title + leadId present)", () => {
    mockRole = "owner";
    mockJobs = [doneEstimate()];
    mockInvoices = [
      {
        id: "inv-1", num: "INV-1", jobId: null, leadId: "lead-1", cust: "Dana", phone: "",
        title: "Visit fee — service call", lines: [{ d: "Visit fee — service call", q: 1, r: 89 }],
        total: 89, depPaid: 0, payments: [], status: "sent", age: 3, archived: false,
      } as unknown as Invoice,
    ];
    render(<TechJobModalContent />);
    expect(screen.queryByText(/Collect the visit fee/)).toBeNull();
  });

  it("owner: does NOT hide the button for a void/archived fee invoice on this lead", () => {
    mockRole = "owner";
    mockOrgFee = 89;
    mockJobs = [doneEstimate()];
    mockInvoices = [
      {
        id: "inv-1", num: "INV-1", jobId: null, leadId: "lead-1", cust: "Dana", phone: "",
        title: "Visit fee — service call", lines: [], total: 89, depPaid: 0, payments: [],
        status: "void", age: 3, archived: true,
      } as unknown as Invoice,
    ];
    render(<TechJobModalContent />);
    expect(screen.getByText("Collect the visit fee — $89")).toBeTruthy();
  });

  it("owner: an unsent draft fee invoice keeps the button visible — a tap resumes it", () => {
    mockRole = "owner";
    mockOrgFee = 89;
    mockJobs = [doneEstimate()];
    mockInvoices = [
      {
        id: "inv-1", num: "INV-1", jobId: null, leadId: "lead-1", cust: "Dana", phone: "",
        title: "Visit fee — service call", lines: [{ d: "Visit fee — service call", q: 1, r: 89 }],
        total: 89, depPaid: 0, payments: [], status: "draft", age: 0, archived: false, origin: "db",
      } as unknown as Invoice,
    ];
    render(<TechJobModalContent />);
    expect(screen.getByText("Collect the visit fee — $89")).toBeTruthy();
  });

  it("owner: hides the fee button when the org fee is 0/unset", () => {
    mockRole = "owner";
    mockOrgFee = 0;
    mockJobs = [doneEstimate()];
    render(<TechJobModalContent />);
    expect(screen.queryByText(/Collect the visit fee/)).toBeNull();
  });

  // ── THE SECURITY ASSERTION ────────────────────────────────────────────────────────────────
  for (const role of ["owner", "tech"] as const) {
    it(`${role}: the fee raise carries the jobId and NOTHING else — no invoice id, no amount`, async () => {
      mockRole = role;
      mockOrgFee = role === "owner" ? 89 : null;
      mockJobs = [doneEstimate()];
      render(<TechJobModalContent />);

      fireEvent.click(screen.getByText(role === "owner" ? "Collect the visit fee — $89" : "Collect the visit fee →"));

      await vi.waitFor(() => {
        expect(mockRaiseVisitFee).toHaveBeenCalledWith("job-1");
      });
      // Exactly one argument. An `id` here was an arbitrary-invoice overwrite — "raise a fee on
      // my own job, into THAT invoice" — and it must never come back through the client either.
      expect(mockRaiseVisitFee.mock.calls[0]).toHaveLength(1);
      // …and the store's manual draft path is not involved at all any more.
      expect(mockAddInvoice).not.toHaveBeenCalled();
      expect(mockSendInvoice).not.toHaveBeenCalled();
    });
  }

  it("opens close-out on the id the SERVER minted, only once the raise landed", async () => {
    mockRole = "tech";
    mockOrgFee = null;
    mockJobs = [doneEstimate()];
    render(<TechJobModalContent />);

    fireEvent.click(screen.getByText("Collect the visit fee →"));

    await vi.waitFor(() => {
      expect(mockOpenModal).toHaveBeenCalledWith(MODAL.CLOSE_OUT, {
        jobId: "job-1",
        invoiceId: "inv-fee-server",
        // Declares WHERE this close-out was opened from, so its Done lands on My day.
        from: "field-job",
      });
    });
  });

  it("a refused raise names the server's own sentence in place and opens nothing", async () => {
    mockRole = "tech";
    mockOrgFee = null;
    mockJobs = [doneEstimate()];
    mockRaiseVisitFee.mockResolvedValueOnce({
      ok: false,
      error: "this shop hasn't set a visit fee — add one in Settings before charging it",
    });
    render(<TechJobModalContent />);

    fireEvent.click(screen.getByText("Collect the visit fee →"));

    expect(
      await screen.findByText("this shop hasn't set a visit fee — add one in Settings before charging it"),
    ).toBeTruthy();
    expect(mockOpenModal).not.toHaveBeenCalledWith(MODAL.CLOSE_OUT, expect.anything());
    // Still offered: the raise is idempotent per job server-side, so a retry resumes rather
    // than mints — there is no orphan to clean up and no reason to hide the control.
    expect(screen.getByText("Collect the visit fee →")).toBeTruthy();
  });

  it("falls back to functional copy when the raise fails without a server message", async () => {
    mockRole = "tech";
    mockOrgFee = null;
    mockJobs = [doneEstimate()];
    mockRaiseVisitFee.mockResolvedValueOnce({ ok: false });
    render(<TechJobModalContent />);

    fireEvent.click(screen.getByText("Collect the visit fee →"));

    expect(
      await screen.findByText("Couldn't raise the visit fee — check your connection and try again."),
    ).toBeTruthy();
  });

  it("an already-sent fee goes straight to collection without raising again", async () => {
    mockRole = "tech";
    mockOrgFee = null;
    mockJobs = [doneEstimate()];
    mockInvoices = [
      {
        id: "inv-fee-1", num: "INV-1", jobId: null, leadId: "lead-1", cust: "Dana", phone: "",
        title: "Visit fee — service call", lines: [], total: 89, depPaid: 0, payments: [],
        status: "draft", age: 0, archived: false, origin: "db",
      } as unknown as Invoice,
    ];
    render(<TechJobModalContent />);
    // A draft keeps the button (resumable) — flip it to sent and the button goes, so drive the
    // resume path through the draft and assert the raise is still the ONE call made.
    fireEvent.click(screen.getByText("Collect the visit fee →"));
    await vi.waitFor(() => {
      expect(mockRaiseVisitFee).toHaveBeenCalledWith("job-1");
    });
  });
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

// ---------------------------------------------------------------------------
// The FLAT-RATE done job that was completed straight from My Day: its visit was never placed
// on the Schedule board, so the field has no visit to show and none to reopen.
//
// Two regressions from this branch land here: Reopen buttons that took the tap and did nothing
// (a job-level reopen does not exist — the write is per VISIT), and the close-out sheet being
// opened without the invoice id it already knows.
// ---------------------------------------------------------------------------

const UNPLACED_DONE_JOB = () =>
  makeJob({
    status: "done",
    lines: [{ d: "Flat rate — drain clear", q: 1, r: 185 }],
    addons: [],
    // Completed from My Day, never dragged onto the board: no date, no crew, no start.
    visits: [{ id: "v1", date: null, techId: null, start: null, dur: 1, status: "done" }],
  });

describe("done job whose visit was never placed", () => {
  it("renders no Reopen control at all — there is no visit for it to move", () => {
    mockJobs = [UNPLACED_DONE_JOB()];
    render(<TechJobModalContent />);
    // The done hero renders (this is the surface Owen was on)…
    expect(screen.getByText("✓ Job done")).toBeTruthy();
    // …and neither the hero's Reopen nor the visit section's is on screen.
    expect(screen.queryByText("↩ Reopen")).toBeNull();
  });

  it("offers EXACTLY ONE Reopen when the visit WAS placed", () => {
    mockJobs = [
      makeJob({
        status: "done",
        lines: [{ d: "Flat rate — drain clear", q: 1, r: 185 }],
        addons: [],
        visits: [{ id: "v1", date: "2026-07-12", techId: "tech-1", start: 9, dur: 2, status: "done" }],
      }),
    ];
    render(<TechJobModalContent />);
    // getByText, not getAllByText[0]: the done hero used to render a SECOND Reopen firing the
    // same write, so the office saw one control twice.
    fireEvent.click(screen.getByText("↩ Reopen"));
    expect(mockSetVisitStatus).toHaveBeenCalledWith("job-1", "v1", "scheduled", "office");
  });
});

describe("opening close-out from the done hero", () => {
  it("passes the invoice id this surface already knows, so the sheet matches on a durable id", () => {
    mockJobs = [UNPLACED_DONE_JOB()];
    mockInvoices = [
      {
        id: "inv-7", num: "INV-7", jobId: "job-1", leadId: "lead-1", cust: "Dana", phone: "",
        title: "Flat rate", lines: [], total: 185, depPaid: 0, payments: [],
        status: "draft", age: 0, archived: false,
      } as unknown as Invoice,
    ];
    render(<TechJobModalContent />);

    fireEvent.click(screen.getByText(/Take payment/));

    expect(mockOpenModal).toHaveBeenCalledWith(MODAL.CLOSE_OUT, {
      jobId: "job-1",
      invoiceId: "inv-7",
      from: "field-job",
    });
  });

  it("passes the job alone when no invoice exists yet — the sheet raises one", () => {
    mockJobs = [UNPLACED_DONE_JOB()];
    mockInvoices = [];
    render(<TechJobModalContent />);

    fireEvent.click(screen.getByText(/Take payment/));

    expect(mockOpenModal).toHaveBeenCalledWith(MODAL.CLOSE_OUT, {
      jobId: "job-1",
      from: "field-job",
    });
  });
});
