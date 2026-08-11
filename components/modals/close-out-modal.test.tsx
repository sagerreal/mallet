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
 *
 * Task 6: the PayBlock's card path is a REAL Stripe Checkout (QR + open link, poll to paid);
 * the fake tap simulation and the inert save-card checkbox are gone. The wiring describe at
 * the bottom drives method → card → mint → poll → adoptInvoice → done through the real modal.
 *
 * "Tech collects at the door": this sheet now OPENS for a technician, so every money write it
 * makes names its API — `v1.fieldInvoicing.*` for the field, `v1.invoicing.*` for the desk — and
 * the office-only capabilities inside it (the price builder, the found-work OK-pill, the
 * what-was-done line, the hand-off) are absent rather than dead for them. The describes at the
 * bottom are the regression fence on both halves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BillAsk, CloseOutModalContent } from "./close-out-modal";
import { toStoreInvoice } from "@/features/money/invoices-hydrator";
import type { InvoiceWriteSurface } from "@/lib/store/invoice-write";
import type { Job, Lead, Invoice } from "@/lib/store/types";
import { MODAL } from "@/lib/store/modal-ids";

// ---------------------------------------------------------------------------
// Store mock — used only by the CloseOutModalContent describe blocks below;
// harmless to the prop-driven BillAsk tests above, which never touch the store.
// ---------------------------------------------------------------------------

let mockActiveParams: Record<string, unknown> = {};
let mockJobs: Job[] = [];
let mockLeads: Lead[] = [];
let mockInvoices: Invoice[] = [];
const noop = vi.fn();
// { invoice, persisted } — the slice's real shape. `persisted` never rejects; the modal awaits
// it to clear its create guard and, on { ok: false }, to render the reason instead of a blank sheet.
let mockCreatePersisted: () => Promise<{ ok: boolean; error?: string }> = () =>
  Promise.resolve({ ok: true });
const mockAddInvoice = vi.fn(() => ({
  invoice: { id: "unexpected", num: "INV-999" },
  persisted: mockCreatePersisted(),
}));
const mockAdoptInvoice = vi.fn();
// recordPayment resolves the SERVER's answer (round 3): it is no longer `=> void`, so a refusal
// is reachable and the sheet must render it instead of the done step. Default: the server accepted.
const mockRecordPayment = vi.fn<
  (id: string, payment: unknown, surface?: InvoiceWriteSurface) => Promise<{ ok: boolean; error?: string }>
>(() => Promise.resolve({ ok: true }));
const mockSendInvoice = vi.fn<(id: string) => Promise<{ ok: boolean; error?: string }>>(() =>
  Promise.resolve({ ok: true }),
);

const mockClose = vi.fn();
const mockDismissModals = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "close-out", params: mockActiveParams }),
  useCloseModal: () => mockClose,
  useDismissModals: () => mockDismissModals,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      jobs: mockJobs,
      invoices: mockInvoices,
      leads: mockLeads,
      services: [],
      addInvoice: mockAddInvoice,
      adoptInvoice: mockAdoptInvoice,
      setInvoiceLines: noop,
      updateJob: noop,
      setJobLines: noop,
      recordPayment: mockRecordPayment,
      sendInvoice: mockSendInvoice,
      updateLead: noop,
      setAddonStatus: noop,
      setAddonInvSkip: noop,
      checkVerifyItem: noop,
      overrideVerifyItem: noop,
      addJobPhoto: noop,
    }),
}));

// The card step and the pre-record freshness check go through the endpoint picker — mocked
// wholesale here, with the SURFACE as the first argument so the routing is assertable.
const mockCreatePayment = vi.fn<(surface: InvoiceWriteSurface, invoiceId: string) => Promise<{ url: string }>>();
const mockGetInvoice = vi.fn<(surface: InvoiceWriteSurface, invoiceId: string) => Promise<Invoice>>();

vi.mock("@/lib/store/invoice-write", () => ({
  mintCheckoutSession: (surface: InvoiceWriteSurface, invoiceId: string) =>
    mockCreatePayment(surface, invoiceId),
  readInvoice: (surface: InvoiceWriteSurface, invoiceId: string) => mockGetInvoice(surface, invoiceId),
}));

// The role decides the write surface AND which controls exist at all. Default: the office, so
// every pre-existing expectation in this file describes unchanged office behaviour.
let mockRole: "owner" | "office" | "tech" = "owner";
vi.mock("@/features/identity/hooks", () => ({
  useMe: () => ({ data: { role: mockRole, userId: "tech-1" }, isLoading: false }),
}));

vi.mock("@/lib/trpc/list-cache", () => ({ invalidateLists: vi.fn() }));

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,QRTEST") },
}));

vi.mock("@/features/settings/use-org-service-fee", () => ({
  useOrgServiceFee: () => 89,
}));

// Outer reset: every describe below starts from the office unless it says otherwise.
beforeEach(() => {
  mockRole = "owner";
});

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
    expect(screen.getByText("$89.00")).toBeTruthy();
    expect(mockAddInvoice).not.toHaveBeenCalled();
  });

  it("still auto-creates via addInvoice for the normal (non-fee) close-out path with no invoiceId param", () => {
    mockActiveParams = { jobId: "job-1" }; // no invoiceId — DoneBlock's ordinary openCloseOut
    mockInvoices = []; // no invoice yet for this job
    render(<CloseOutModalContent />);
    expect(mockAddInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", leadId: "lead-1" }),
      "office",
    );
  });

  it("MODAL.CLOSE_OUT id constant matches what the mock returns", () => {
    expect(MODAL.CLOSE_OUT).toBe("close-out");
  });
});

// ---------------------------------------------------------------------------
// Task 6 wiring — Take payment → Card → real checkout QR → poll flips paid →
// the fresh DTO is adopted into the store and the done step renders. The fake
// tap theater (the simulated-tap button, the inert save-card checkbox) must be GONE.
// ---------------------------------------------------------------------------

const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_a1b2c3";

const cardJob: Job = {
  id: "job-1",
  leadId: "lead-1",
  svc: "estimate",
  origin: "db",
  title: "Fix water heater",
  addr: "12 Oak St",
  phone: "",
  status: "done",
  archived: false,
  lines: [{ d: "Fix water heater", q: 1, r: 450 }],
  addons: [],
  photos: [],
  notes: "",
  acts: [],
  visits: [],
};

const cardInvoice: Invoice = {
  id: "inv-1", num: "INV-810", jobId: "job-1", leadId: "lead-1", cust: "Dana Alvarez", phone: "",
  title: "Fix water heater", lines: [{ d: "Fix water heater", q: 1, r: 450 }],
  total: 450, depPaid: 0, payments: [], status: "sent", age: 0, archived: false, origin: "db",
} as unknown as Invoice;

// What a fresh read resolves to. `readInvoice` now owns both the call and the DTO→store mapping
// (it has to: the office and the field answer with different wire shapes), so what reaches this
// component is already a store Invoice.
const paidRecord = {
  id: "inv-1",
  num: "INV-810",
  jobId: "job-1",
  leadId: "lead-1",
  cust: "Dana Alvarez",
  phone: "",
  title: "Fix water heater",
  status: "paid",
  total: 450,
  tax: 0,
  depPaid: 0,
  payments: [{ amt: 450, when: "12:00 PM", method: "card" }],
  termsDays: 7,
  lines: [{ d: "Fix water heater", q: 1, r: 450 }],
  age: 0,
  dueAt: "2026-07-07",
  archived: false,
  origin: "db",
} as unknown as Invoice;

describe("CloseOutModalContent — card = real Stripe checkout (Task 6)", () => {
  beforeEach(() => {
    mockActiveParams = { jobId: "job-1" };
    mockJobs = [cardJob];
    mockLeads = [feeLead];
    mockInvoices = [cardInvoice];
    mockAddInvoice.mockClear();
    mockAdoptInvoice.mockClear();
    mockSendInvoice.mockClear();
    mockCreatePayment.mockReset();
    mockGetInvoice.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function openCardStep() {
    mockCreatePayment.mockResolvedValue({ url: CHECKOUT_URL });
    mockGetInvoice.mockResolvedValue(paidRecord);
    render(<CloseOutModalContent />);
    fireEvent.click(screen.getByText("Take payment — $450"));
    fireEvent.click(screen.getByText("Card"));
    await act(async () => {}); // mint lands
  }

  it("Card mints a checkout session and renders the QR + open link (no fake tap, no save-card)", async () => {
    await openCardStep();

    expect(mockCreatePayment).toHaveBeenCalledTimes(1);
    expect(mockCreatePayment).toHaveBeenCalledWith("office", "inv-1");
    // Already "sent" — no draft-send needed.
    expect(mockSendInvoice).not.toHaveBeenCalled();

    // getBy, not findBy: findBy's waitFor stalls under vitest fake timers, and the
    // mocked mint + encode already landed inside openCardStep's act flush.
    expect(screen.getByAltText("Payment QR code")).toBeTruthy();
    const link = screen.getByText("Open payment page") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(CHECKOUT_URL);
    expect(link.getAttribute("target")).toBe("_blank");

    // The simulation theater is dead.
    expect(screen.queryByText(/Simulate/)).toBeNull();
    expect(screen.queryByText(/card on file/i)).toBeNull();
  });

  it("poll flip to paid adopts the reconciled invoice into the store and advances to done", async () => {
    await openCardStep();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });

    expect(mockGetInvoice).toHaveBeenCalledWith("office", "inv-1");
    expect(mockAdoptInvoice).toHaveBeenCalledTimes(1);
    expect(mockAdoptInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inv-1", status: "paid", origin: "db", total: 450 }),
    );
    // Done step (the existing done handling) — no recordPayment double-write:
    // the webhook recorded the money; the poll only adopted the fresh DTO.
    expect(screen.getByText(/Approved · \$450/)).toBeTruthy();
  });

  // THE PRIMARY PATH: close-out auto-creates the invoice via createFromJob (a server
  // DRAFT, reconciled origin "db"), the tech taps Card — send is awaited, THEN the
  // session is minted with the SAME id, and the QR genuinely appears.
  it("auto-created draft (db origin): send awaited BEFORE mint, same id end-to-end, QR renders", async () => {
    mockInvoices = [{ ...cardInvoice, status: "draft" } as Invoice];
    let resolveSend!: (v: { ok: boolean; error?: string }) => void;
    mockSendInvoice.mockImplementationOnce(() => new Promise((res) => (resolveSend = res)));
    mockCreatePayment.mockResolvedValue({ url: CHECKOUT_URL });
    mockGetInvoice.mockResolvedValue(paidRecord);

    render(<CloseOutModalContent />);
    fireEvent.click(screen.getByText("Take payment — $450"));
    fireEvent.click(screen.getByText("Card"));
    await act(async () => {});

    expect(mockSendInvoice).toHaveBeenCalledWith("inv-1", "office");
    expect(mockCreatePayment).not.toHaveBeenCalled(); // send not resolved yet

    await act(async () => {
      resolveSend({ ok: true });
    });
    expect(mockCreatePayment).toHaveBeenCalledTimes(1);
    expect(mockCreatePayment).toHaveBeenCalledWith("office", "inv-1"); // ONE id end-to-end
    await act(async () => {});
    expect(screen.getByAltText("Payment QR code")).toBeTruthy();
    expect(screen.getByText("Open payment page")).toBeTruthy();
  });

  it("createPayment PRECONDITION_FAILED shows the server sentence and the record fallback works", async () => {
    const serverSentence =
      "this shop hasn't finished Stripe payment setup — connect Stripe in Settings first";
    mockCreatePayment.mockRejectedValue({
      message: serverSentence,
      data: { code: "PRECONDITION_FAILED" },
    });
    mockGetInvoice.mockResolvedValue(paidRecord);

    render(<CloseOutModalContent />);
    fireEvent.click(screen.getByText("Take payment — $450"));
    fireEvent.click(screen.getByText("Card"));
    await act(async () => {});

    expect(screen.getByText(serverSentence)).toBeTruthy();

    // Fallback: the record step opens (method preselected) — never a dead end.
    fireEvent.click(screen.getByText("They paid another way — record it instead"));
    expect(screen.getByText(/Record cash — paid/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Fix round 1 — approvePayment ordering + the paid-via-QR race.
//
// recordPayment refuses drafts server-side (record-payment.ts guards sent|partial),
// so recording BEFORE sending silently failed on every fresh draft: the server
// 404'd/refused, the slice rolled the optimistic payment back with a dev-only log,
// and the tech saw "Approved". Order is now send (awaited ok) → record — the same
// ordering the card step uses. And because the customer may complete the checkout
// QR while the tech reaches for "record it instead", one fresh status read runs
// first: an already-paid invoice jumps to done instead of double-recording.
// ---------------------------------------------------------------------------

describe("CloseOutModalContent — record ordering + paid race (fix round 1)", () => {
  beforeEach(() => {
    mockActiveParams = { jobId: "job-1" };
    mockJobs = [cardJob];
    mockLeads = [feeLead];
    mockInvoices = [cardInvoice];
    mockAddInvoice.mockClear();
    mockAdoptInvoice.mockClear();
    mockRecordPayment.mockClear();
    mockSendInvoice.mockClear();
    mockSendInvoice.mockImplementation(() => Promise.resolve({ ok: true }));
    mockCreatePayment.mockReset();
    mockGetInvoice.mockReset();
  });

  async function clickRecordCash() {
    render(<CloseOutModalContent />);
    fireEvent.click(screen.getByText("Take payment — $450"));
    fireEvent.click(screen.getByText("Cash"));
    fireEvent.click(screen.getByText(/Record cash — paid/));
    await act(async () => {});
  }

  it("a DRAFT is sent (awaited ok) BEFORE recordPayment fires — order asserted", async () => {
    mockInvoices = [{ ...cardInvoice, status: "draft" } as Invoice];
    // Fresh pre-record read sees the draft — not paid, proceed.
    mockGetInvoice.mockResolvedValue({ ...paidRecord, status: "draft" } as Invoice);
    let resolveSend!: (v: { ok: boolean; error?: string }) => void;
    mockSendInvoice.mockImplementationOnce(() => new Promise((res) => (resolveSend = res)));

    await clickRecordCash();

    expect(mockSendInvoice).toHaveBeenCalledWith("inv-1", "office");
    expect(mockRecordPayment).not.toHaveBeenCalled(); // send not resolved yet

    await act(async () => {
      resolveSend({ ok: true });
    });
    expect(mockRecordPayment).toHaveBeenCalledTimes(1);
    expect(mockRecordPayment).toHaveBeenCalledWith(
      "inv-1",
      expect.objectContaining({ amt: 450, method: "cash" }),
      "office",
    );
    expect(screen.getByText(/Approved · \$450/)).toBeTruthy();
  });

  it("a failed send BLOCKS the record: error named in place, nothing recorded, no Approved", async () => {
    mockInvoices = [{ ...cardInvoice, status: "draft" } as Invoice];
    mockGetInvoice.mockResolvedValue({ ...paidRecord, status: "draft" } as Invoice);
    mockSendInvoice.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, error: "an invoice needs at least one line" }),
    );

    await clickRecordCash();

    expect(mockRecordPayment).not.toHaveBeenCalled();
    expect(screen.getByText("an invoice needs at least one line")).toBeTruthy();
    expect(screen.queryByText(/Approved/)).toBeNull();
  });

  it("paid-via-QR race: the fresh read sees paid → adopt + done, recordPayment NEVER fires", async () => {
    mockGetInvoice.mockResolvedValue(paidRecord); // customer finished the checkout already

    await clickRecordCash();

    expect(mockGetInvoice).toHaveBeenCalledWith("office", "inv-1");
    expect(mockRecordPayment).not.toHaveBeenCalled();
    expect(mockSendInvoice).not.toHaveBeenCalled(); // already sent AND already paid
    expect(mockAdoptInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inv-1", status: "paid" }),
    );
    expect(screen.getByText(/Approved · \$450/)).toBeTruthy();
    expect(screen.getByText(/Stripe checkout/)).toBeTruthy(); // what ACTUALLY happened, not "Cash recorded"
  });

  it("an unreadable pre-record check does not strand the tech — the record proceeds", async () => {
    mockGetInvoice.mockRejectedValue(new Error("offline"));

    await clickRecordCash();

    expect(mockRecordPayment).toHaveBeenCalledTimes(1); // server remains the final guard
    expect(screen.getByText(/Approved · \$450/)).toBeTruthy();
  });

  // Fix round 2: approve() went async in round 1, so "Record cash — paid" stays mounted
  // through the network round-trip. Each record mints a FRESH idempotency key, so the server
  // cannot dedupe a double tap — and on a PARTIAL amount the invoice stays payable, so the
  // second record genuinely applies. Single-flight: re-entry is a no-op, the button reads busy.
  it("two rapid taps on Record record EXACTLY once (single-flight, button disabled in flight)", async () => {
    let resolveGet!: (v: Invoice) => void;
    mockGetInvoice.mockImplementationOnce(() => new Promise<Invoice>((res) => (resolveGet = res)));

    render(<CloseOutModalContent />);
    fireEvent.click(screen.getByText("Take payment — $450"));
    fireEvent.click(screen.getByText("Cash"));

    const recordBtn = screen.getByText(/Record cash — paid/).closest("button") as HTMLButtonElement;
    fireEvent.click(recordBtn);
    fireEvent.click(recordBtn); // the double tap
    await act(async () => {});

    // In flight: visually busy AND genuinely disabled.
    expect((screen.getByText(/Recording…/).closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText(/Recording…/).closest("button") as HTMLButtonElement); // third tap, mid-flight

    await act(async () => {
      resolveGet({ ...paidRecord, status: "sent" } as Invoice); // not paid — the record proceeds
    });

    expect(mockRecordPayment).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Approved · \$450/)).toBeTruthy();
  });

  // Fix round 2 LOW: the send-vs-not decision must trust the FRESH read, not the store —
  // a store row optimistically flipped to "sent" over a server row still in draft would
  // otherwise record straight into the draft guard (silent rollback behind "Approved").
  it("store says sent but the server row is draft → send is awaited before the record", async () => {
    mockGetInvoice.mockResolvedValue({ ...paidRecord, status: "draft" } as Invoice); // server truth
    mockInvoices = [cardInvoice]; // store says "sent"

    await clickRecordCash();

    expect(mockSendInvoice).toHaveBeenCalledWith("inv-1", "office");
    expect(mockRecordPayment).toHaveBeenCalledTimes(1);
    // Order: the send resolved before the record fired (both landed inside one flush,
    // so the call-order assertion is the invocationCallOrder below).
    const sendOrder = mockSendInvoice.mock.invocationCallOrder[0] ?? 0;
    const recordOrder = mockRecordPayment.mock.invocationCallOrder[0] ?? 0;
    expect(sendOrder).toBeLessThan(recordOrder);
  });

  // -------------------------------------------------------------------------
  // Fix round 3 — the RECORD'S OWN refusal.
  //
  // Rounds 1 and 2 closed the two PRE-conditions (draft-not-sent, already-paid-by-QR). The
  // record itself stayed unawaited: the store action was typed `=> void`, kicked off the write
  // and rolled back inside a `.catch`, so approvePayment returned { ok: true } on the very next
  // line. A voided invoice, a payment that landed concurrently, an offline tech — every one of
  // them rendered "Approved · $450" for money that was never recorded.
  // -------------------------------------------------------------------------

  it("the server REFUSING the record blocks Approved: its reason is named on the record step", async () => {
    mockGetInvoice.mockResolvedValue({ ...paidRecord, status: "sent" } as Invoice);
    mockRecordPayment.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, error: "this invoice is void" }),
    );

    await clickRecordCash();

    expect(mockRecordPayment).toHaveBeenCalledTimes(1);
    expect(screen.getByText("this invoice is void")).toBeTruthy();
    expect(screen.queryByText(/Approved/)).toBeNull();
    // Still on the record step — the tech can fix it and try again, not a dead end.
    expect(screen.getByText(/Record cash — paid/)).toBeTruthy();
  });

  it("a refusal with no sentence still refuses — never a silent Approved", async () => {
    mockGetInvoice.mockResolvedValue({ ...paidRecord, status: "sent" } as Invoice);
    mockRecordPayment.mockImplementationOnce(() => Promise.resolve({ ok: false }));

    await clickRecordCash();

    expect(screen.queryByText(/Approved/)).toBeNull();
    expect(screen.getByText(/Couldn't record the payment/)).toBeTruthy();
  });

  it("charge-on-file takes the same refusal path — no Approved on a rejected card record", async () => {
    mockGetInvoice.mockResolvedValue({ ...paidRecord, status: "sent" } as Invoice);
    mockRecordPayment.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, error: "this invoice is already paid in full" }),
    );

    mockLeads = [{ ...feeLead, card: { brand: "Visa", last4: "4242" } } as unknown as Lead];

    render(<CloseOutModalContent />);
    fireEvent.click(screen.getByText("Take payment — $450"));
    fireEvent.click(screen.getByText(/Charge Visa/));
    await act(async () => {});

    expect(screen.getByText("this invoice is already paid in full")).toBeTruthy();
    expect(screen.queryByText(/Approved/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The sheet can never dead-end.
//
// THE BUG: the body returned null whenever it had no invoice yet, inside a modal shell that
// was already on screen. `creatingRef` was stamped on the first render and NEVER cleared, so a
// createFromJob that FAILED — a technician hitting the ownerOrOffice gate gets FORBIDDEN, a job
// the server does not consider complete gets CONFLICT — left the technician holding a collapsed
// white sliver with nothing on it but a ✕, with no way to tell what happened or to try again.
// ---------------------------------------------------------------------------

describe("CloseOutModalContent — never an empty sheet", () => {
  const deferredCreate = () => {
    let settle: (r: { ok: boolean; error?: string }) => void = () => {};
    const promise = new Promise<{ ok: boolean; error?: string }>((res) => {
      settle = res;
    });
    return { promise, settle };
  };

  beforeEach(() => {
    mockActiveParams = { jobId: "job-1" };
    mockJobs = [cardJob];
    mockLeads = [feeLead];
    mockInvoices = []; // no invoice for this job yet — the auto-create path
    mockAddInvoice.mockClear();
    mockCreatePersisted = () => Promise.resolve({ ok: true });
  });

  it("shows that the invoice is being raised while the create is in flight", () => {
    const pending = deferredCreate();
    mockCreatePersisted = () => pending.promise;

    render(<CloseOutModalContent />);

    expect(screen.getByText("Raising the invoice…")).toBeTruthy();
    // The sheet still says which job it is — the technician is never looking at a blank panel.
    expect(screen.getByText("Fix water heater")).toBeTruthy();
  });

  it("renders the server's own reason when the create fails, not a blank sheet", async () => {
    mockCreatePersisted = () =>
      Promise.resolve({ ok: false, error: "job must be complete before it can be invoiced" });

    render(<CloseOutModalContent />);
    await act(async () => {});

    expect(screen.getByText("Couldn't raise the invoice")).toBeTruthy();
    expect(screen.getByText("job must be complete before it can be invoiced")).toBeTruthy();
    expect(screen.queryByText("Raising the invoice…")).toBeNull();
  });

  it("Try again re-fires the create, and the sheet renders once the invoice lands", async () => {
    mockCreatePersisted = () => Promise.resolve({ ok: false, error: "Your role can't do that." });

    const { rerender } = render(<CloseOutModalContent />);
    await act(async () => {});
    expect(mockAddInvoice).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Your role can't do that.")).toBeTruthy();

    // The retry genuinely re-fires the mutation — this is what the never-cleared guard ref made
    // impossible, and why the sliver was permanent.
    const pending = deferredCreate();
    mockCreatePersisted = () => pending.promise;
    fireEvent.click(screen.getByText("Try again"));
    await act(async () => {});

    expect(mockAddInvoice).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Your role can't do that.")).toBeNull();
    expect(screen.getByText("Raising the invoice…")).toBeTruthy();

    // …and once the invoice reaches the store, the real close-out replaces the notice.
    mockInvoices = [cardInvoice];
    await act(async () => {
      pending.settle({ ok: true });
    });
    rerender(<CloseOutModalContent />);
    expect(screen.getByText("Take payment — $450")).toBeTruthy();
  });

  it("says so when handed an invoice id this device never loaded", () => {
    mockActiveParams = { jobId: "job-1", invoiceId: "inv-not-here" };

    render(<CloseOutModalContent />);

    expect(screen.getByText("That invoice isn't loaded")).toBeTruthy();
    expect(mockAddInvoice).not.toHaveBeenCalled();
  });

  it("says so when the job itself isn't loaded", () => {
    mockJobs = [];

    render(<CloseOutModalContent />);

    expect(screen.getByText(/This job isn't loaded/)).toBeTruthy();
  });

  // The end-to-end shape of the original bug: the store row the HYDRATOR produces — not a
  // hand-written fixture — must carry the job link, or this sheet finds nothing and either
  // raises a duplicate invoice or (before the fix) renders a white sliver forever.
  it("finds the job's invoice on a row built by the real list mapper", () => {
    mockInvoices = [
      toStoreInvoice({
        id: "inv-1",
        num: "INV-810",
        leadId: "lead-1",
        sourceJobId: "job-1",
        customerName: "Dana Alvarez",
        customerPhone: "",
        title: "Fix water heater",
        status: "sent",
        total: { cents: 45_000, currency: "USD" },
        due: { cents: 45_000, currency: "USD" },
        dueAt: null,
        followUpOn: false,
        followUpStage: 0,
        createdAt: "2026-07-30T09:00:00.000Z",
      } as Parameters<typeof toStoreInvoice>[0]),
    ];

    render(<CloseOutModalContent />);

    expect(mockAddInvoice).not.toHaveBeenCalled();
    expect(screen.getByText("Take payment — $450")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// THE TECHNICIAN AT THE DOOR.
//
// This sheet used to be protected only by being unreachable. It opens for a technician now, so
// the two properties that matter are asserted here together: every money write reaches
// v1.fieldInvoicing.* (an office procedure would FORBIDDEN with the customer standing there),
// and every office-only capability inside the sheet is ABSENT rather than dead.
// ---------------------------------------------------------------------------

describe("CloseOutModalContent — a technician collects", () => {
  beforeEach(() => {
    mockRole = "tech";
    mockActiveParams = { jobId: "job-1" };
    mockJobs = [cardJob];
    mockLeads = [feeLead];
    mockInvoices = [cardInvoice];
    mockAddInvoice.mockClear();
    mockAdoptInvoice.mockClear();
    mockRecordPayment.mockClear();
    mockSendInvoice.mockClear();
    mockSendInvoice.mockImplementation(() => Promise.resolve({ ok: true }));
    mockCreatePayment.mockReset();
    mockGetInvoice.mockReset();
  });

  it("shows the balance and the payment surfaces", () => {
    render(<CloseOutModalContent />);
    expect(screen.getByText("Take payment — $450")).toBeTruthy();
    fireEvent.click(screen.getByText("Take payment — $450"));
    expect(screen.getByText("Cash")).toBeTruthy();
    expect(screen.getByText("Check")).toBeTruthy();
    expect(screen.getByText("Bank")).toBeTruthy();
  });

  it("raises the invoice through the FIELD surface, never the office one", () => {
    mockInvoices = [];
    render(<CloseOutModalContent />);
    expect(mockAddInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", leadId: "lead-1" }),
      "field",
    );
  });

  it("reads, sends and records through the FIELD surface", async () => {
    mockInvoices = [{ ...cardInvoice, status: "draft" } as Invoice];
    mockGetInvoice.mockResolvedValue({ ...paidRecord, status: "draft" } as Invoice);

    render(<CloseOutModalContent />);
    fireEvent.click(screen.getByText("Take payment — $450"));
    fireEvent.click(screen.getByText("Cash"));
    fireEvent.click(screen.getByText(/Record cash — paid/));
    await act(async () => {});

    expect(mockGetInvoice).toHaveBeenCalledWith("field", "inv-1");
    expect(mockSendInvoice).toHaveBeenCalledWith("inv-1", "field");
    expect(mockRecordPayment).toHaveBeenCalledWith(
      "inv-1",
      expect.objectContaining({ amt: 450, method: "cash" }),
      "field",
    );
    expect(screen.getByText(/Approved · \$450/)).toBeTruthy();
  });

  it("the card checkout mints through the FIELD surface", async () => {
    mockCreatePayment.mockResolvedValue({ url: CHECKOUT_URL });
    mockGetInvoice.mockResolvedValue(paidRecord);
    render(<CloseOutModalContent />);
    fireEvent.click(screen.getByText("Take payment — $450"));
    fireEvent.click(screen.getByText("Card"));
    await act(async () => {});
    expect(mockCreatePayment).toHaveBeenCalledWith("field", "inv-1");
  });

  it("offers no hand-off — it is an ownerOrOffice write", () => {
    render(<CloseOutModalContent />);
    expect(screen.queryByText(/Log & send to office/)).toBeNull();
  });

  // A field device cannot compute this job's total: `jobTotal` is 0 when the shop withholds rates,
  // and even unredacted it is the raw line sum with no deposit credited and no recorded tax.
  // Rendering the optimistic row would put a wrong figure on the Take-payment button and pre-fill
  // the amount box with it, and a tap inside the round-trip records against the wrong balance.
  it("waits for the server's balance rather than drawing the redacted job's $0", () => {
    mockJobs = [{ ...cardJob, lines: [{ d: "Fix water heater", q: 1, r: null }] } as unknown as Job];
    // The optimistic row addInvoice just inserted: origin "manual", total 0.
    mockInvoices = [{ ...cardInvoice, total: 0, lines: [], origin: "manual" } as unknown as Invoice];
    render(<CloseOutModalContent />);

    expect(screen.getByText("Reading the balance…")).toBeTruthy();
    expect(screen.queryByText(/Take payment/)).toBeNull();
    expect(screen.queryByText("Done")).toBeNull();
  });

  // The gate is the SURFACE, not the redaction: the deposit skew has nothing to do with hidden
  // prices, and a job with no lines at all makes `pricesHidden` false while `jobTotal` is still 0.
  it("waits on a deposit-credited job even when this device CAN see the rates", () => {
    // $1,000 of lines, $200 already taken — the server says $800, the optimistic row says $1,000.
    mockInvoices = [
      { ...cardInvoice, total: 450, depPaid: 200, origin: "manual" } as unknown as Invoice,
    ];
    render(<CloseOutModalContent />);

    expect(screen.getByText("Reading the balance…")).toBeTruthy();
    expect(screen.queryByText(/Take payment/)).toBeNull();
  });

  it("renders the sheet the moment the server's record lands", () => {
    mockJobs = [{ ...cardJob, lines: [{ d: "Fix water heater", q: 1, r: null }] } as unknown as Job];
    mockInvoices = [{ ...cardInvoice, lines: [], origin: "db" } as unknown as Invoice];
    render(<CloseOutModalContent />);

    expect(screen.queryByText("Reading the balance…")).toBeNull();
    expect(screen.getByText("Take payment — $450")).toBeTruthy();
  });

  // A withheld add-on rate reduced with `?? 0` prints "$0 in found work", which reads as "nothing
  // extra was found" — the exact opposite of the warning this card exists to give.
  it("names no figure on found work whose rate this device may not see, never $0", () => {
    mockJobs = [
      {
        ...cardJob,
        addons: [{ id: 1, d: "Expansion tank", q: 1, r: null, status: "proposed" }],
      } as unknown as Job,
    ];
    render(<CloseOutModalContent />);

    expect(screen.getByText("⚠ Found work — not on this bill")).toBeTruthy();
    expect(screen.getByText("Expansion tank")).toBeTruthy();
    expect(screen.queryByText(/\$0\b/)).toBeNull();
  });

  it("never shows the price BUILDER, even on a genuinely unpriced job", () => {
    const unpricedJob = { ...cardJob, lines: [] } as Job;
    mockJobs = [unpricedJob];
    mockInvoices = [{ ...cardInvoice, total: 0, lines: [] } as Invoice];
    render(<CloseOutModalContent />);
    expect(screen.queryByText("No price on this job yet — what did it run?")).toBeNull();
    // …and with nothing owed and no office writes to offer, the foot is a plain Done, never a
    // hand-off button their token would refuse.
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("found work is read-only and does NOT disable Take payment", () => {
    const jobWithFoundWork = {
      ...cardJob,
      addons: [{ id: 1, d: "Expansion tank", q: 1, r: 320, status: "proposed" }],
    } as unknown as Job;
    mockJobs = [jobWithFoundWork];
    render(<CloseOutModalContent />);

    // The list is there — the technician can see what is NOT on this bill…
    expect(screen.getByText("Expansion tank")).toBeTruthy();
    expect(screen.getByText(/not on this bill/)).toBeTruthy();
    // …but the approval pill is the office's.
    expect(screen.queryByText(/OK’d — include/)).toBeNull();
    expect(screen.queryByText("Leave off")).toBeNull();
    // And the pay button is LIVE: the only way to clear `pending` is setAddonStatus, which is
    // office-only by law, so a disable here could never be cleared from this device.
    const pay = screen.getByText("Take payment — $450").closest("button") as HTMLButtonElement;
    expect(pay.disabled).toBe(false);
  });
});

describe("CloseOutModalContent — the office keeps its own gates (regression fence)", () => {
  beforeEach(() => {
    mockActiveParams = { jobId: "job-1" };
    mockLeads = [feeLead];
    mockInvoices = [cardInvoice];
  });

  it("found work still blocks Take payment and still offers the OK-pill", () => {
    const jobWithFoundWork = {
      ...cardJob,
      addons: [{ id: 1, d: "Expansion tank", q: 1, r: 320, status: "proposed" }],
    } as unknown as Job;
    mockJobs = [jobWithFoundWork];
    render(<CloseOutModalContent />);

    expect(screen.getByText(/awaiting the customer/)).toBeTruthy();
    expect(screen.getByText(/OK’d — include/)).toBeTruthy();
    const pay = screen.getByText("Take payment — $450").closest("button") as HTMLButtonElement;
    expect(pay.disabled).toBe(true);
  });

  // The fence on the field's wait-for-the-balance gate: the office must never see it, or the whole
  // desk starts staring at a spinner on a sheet that used to render instantly.
  it("never waits on an optimistic row — the desk renders it straight away", () => {
    mockJobs = [cardJob];
    mockInvoices = [{ ...cardInvoice, origin: "manual" } as unknown as Invoice];
    render(<CloseOutModalContent />);

    expect(screen.queryByText("Reading the balance…")).toBeNull();
    expect(screen.getByText("Take payment — $450")).toBeTruthy();
  });

  it("still offers the hand-off and the price builder", () => {
    mockJobs = [{ ...cardJob, lines: [] } as Job];
    mockInvoices = [{ ...cardInvoice, total: 0, lines: [] } as Invoice];
    render(<CloseOutModalContent />);

    expect(screen.getByText("No price on this job yet — what did it run?")).toBeTruthy();
    expect(screen.getByText(/Log & send to office/)).toBeTruthy();
  });

  // The box is gone for EVERY role, not hidden from one. Its label promised the text went on the
  // customer's invoice and nothing in the invoicing module has ever read job.completion.
  it("offers no what-was-done box to the office either", () => {
    mockJobs = [{ ...cardJob, lines: [] } as Job];
    mockInvoices = [{ ...cardInvoice, total: 0, lines: [] } as Invoice];
    render(<CloseOutModalContent />);

    expect(screen.queryByText("What was done")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WHERE DONE LANDS.
//
// Owen, testing: "after I took the payment it brought me back [to the job sheet], it should bring
// me [to My day]". The close-out is pushed as a drill-in, so its finish popped to the tech job
// sheet — a record of the job he had just finished, with nothing left to do on it. A TERMINAL step
// has to leave the stack, and it decides that from the OPENER'S DECLARED INTENT (`from`), never
// from role: an owner-operator collecting at the customer's door is `owner` and still belongs on
// My day. The office drill (Money → invoice → …) keeps popping to its parent.
// ---------------------------------------------------------------------------

describe("CloseOutModalContent — where Done lands", () => {
  beforeEach(() => {
    mockLeads = [feeLead];
    mockClose.mockClear();
    mockDismissModals.mockClear();
  });

  it("Done from a field job dismisses the whole stack — the tech lands on My day", () => {
    mockRole = "tech";
    mockActiveParams = { jobId: "job-1", from: "field-job" };
    mockJobs = [{ ...cardJob, lines: [] } as Job];
    mockInvoices = [{ ...cardInvoice, total: 0, lines: [] } as Invoice];
    render(<CloseOutModalContent />);

    fireEvent.click(screen.getByText("Done"));

    expect(mockDismissModals).toHaveBeenCalledTimes(1);
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("an owner-operator collecting at the door lands on My day too — role is not the signal", () => {
    mockRole = "owner";
    mockActiveParams = { jobId: "job-1", from: "field-job" };
    mockJobs = [{ ...cardJob, lines: [] } as Job];
    mockInvoices = [{ ...cardInvoice, total: 0, lines: [] } as Invoice];
    render(<CloseOutModalContent />);

    // Nothing due + office role → the hand-off IS the wrap-up confirm.
    fireEvent.click(screen.getByText(/Log & send to office/));

    expect(mockDismissModals).toHaveBeenCalledTimes(1);
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("an office drill with no declared opener still pops to its parent", () => {
    mockRole = "owner";
    mockActiveParams = { jobId: "job-1" };
    mockJobs = [{ ...cardJob, lines: [] } as Job];
    mockInvoices = [{ ...cardInvoice, total: 0, lines: [] } as Invoice];
    render(<CloseOutModalContent />);

    fireEvent.click(screen.getByText(/Log & send to office/));

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockDismissModals).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The optimistic due figure — the hydration-flash law applied to money. The sheet raises the
// invoice on mount and draws the row it just asked for; that draw used to carry the RAW LINE SUM
// (`jobTotal`), so a $100 job with the shop's stored 8.45% sales tax flashed "$100" and snapped
// to "$108.45" when the server's answer landed. The draw now derives the same discount → tax
// chain the server bills (job.pricing through deriveTotals), so the figure never changes — and
// the one figure the client genuinely cannot derive (an estimate's deposit credit) is GATED
// behind the server's answer instead of guessed at.
// ---------------------------------------------------------------------------

describe("CloseOutModalContent — the optimistic due figure is the BILLED total", () => {
  const pricedJob: Job = {
    ...cardJob,
    lines: [{ d: "Drain clear", q: 1, r: 100 }],
    pricing: { disc: 0, tax: 8.45 },
  };

  beforeEach(() => {
    mockRole = "owner";
    mockActiveParams = { jobId: "job-1" };
    mockJobs = [pricedJob];
    mockLeads = [feeLead];
    mockInvoices = [];
    mockAddInvoice.mockClear();
    mockCreatePersisted = () => Promise.resolve({ ok: true });
  });

  it("raises the invoice carrying the tax-inclusive total, never the raw line sum", () => {
    render(<CloseOutModalContent />);
    expect(mockAddInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ total: 108.45, tax: 8.45 }),
      "office",
    );
  });

  it("a stored discount rides the same chain (discount → net → tax)", () => {
    mockJobs = [{ ...pricedJob, pricing: { disc: 10, tax: 8.45 } }];
    render(<CloseOutModalContent />);
    expect(mockAddInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ total: 97.61, disc: 10 }),
      "office",
    );
  });

  it("an optimistic row on a NON-estimate job still renders the money card (no new gate)", () => {
    mockJobs = [{ ...cardJob }];
    mockInvoices = [{ ...cardInvoice, origin: "manual" } as unknown as Invoice];
    render(<CloseOutModalContent />);
    expect(screen.getByText("Take payment — $450")).toBeTruthy();
  });

  it("an ESTIMATE-SOURCED job's optimistic row is gated — the deposit credit is server knowledge", () => {
    mockJobs = [{ ...cardJob, sourceEstimateId: "est-1" }];
    mockInvoices = [{ ...cardInvoice, origin: "manual" } as unknown as Invoice];
    render(<CloseOutModalContent />);
    expect(screen.getByText("Reading the balance…")).toBeTruthy();
    expect(screen.queryByText(/Take payment/)).toBeNull();
  });
});
