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
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BillAsk, CloseOutModalContent } from "./close-out-modal";
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
const mockAddInvoice = vi.fn(() => ({ id: "unexpected", num: "INV-999" }));
const mockAdoptInvoice = vi.fn();
const mockSendInvoice = vi.fn<(id: string) => Promise<{ ok: boolean; error?: string }>>(() =>
  Promise.resolve({ ok: true }),
);

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
      adoptInvoice: mockAdoptInvoice,
      setInvoiceLines: noop,
      updateJob: noop,
      setJobLines: noop,
      recordPayment: noop,
      sendInvoice: mockSendInvoice,
      updateLead: noop,
      setAddonStatus: noop,
      setAddonInvSkip: noop,
      checkVerifyItem: noop,
      overrideVerifyItem: noop,
      addJobPhoto: noop,
    }),
}));

// The card step talks to the server directly (mint + poll) — mocked wholesale here.
const mockCreatePayment = vi.fn<(input: unknown) => Promise<{ url: string }>>();
const mockGetInvoice = vi.fn<(input: unknown) => Promise<unknown>>();

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      invoicing: {
        createPayment: { mutate: (input: unknown) => mockCreatePayment(input) },
        get: { query: (input: unknown) => mockGetInvoice(input) },
      },
    },
  },
}));

vi.mock("@/lib/trpc/list-cache", () => ({ invalidateLists: vi.fn() }));

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,QRTEST") },
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

// Full invoiceDTO shape — the parent runs it through dtoInvoiceToStore on adopt.
const paidDto = {
  id: "inv-1",
  num: "INV-810",
  sourceJobId: "job-1",
  leadId: "lead-1",
  title: "Fix water heater",
  status: "paid",
  total: { cents: 45_000, currency: "USD" },
  taxBps: 0,
  tax: { cents: 0, currency: "USD" },
  depositPaid: { cents: 0, currency: "USD" },
  payments: [
    { amount: { cents: 45_000, currency: "USD" }, method: "card", receivedAt: "2026-06-30T12:00:00.000Z" },
  ],
  termsDays: 7,
  lines: [
    {
      description: "Fix water heater",
      quantity: 1,
      rate: { cents: 45_000, currency: "USD" },
      cost: { cents: 0, currency: "USD" },
    },
  ],
  createdAt: "2026-06-30T12:00:00.000Z",
  dueAt: "2026-07-07",
  followUpOn: false,
  followUpStage: 0,
};

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
    mockGetInvoice.mockResolvedValue(paidDto);
    render(<CloseOutModalContent />);
    fireEvent.click(screen.getByText("Take payment — $450"));
    fireEvent.click(screen.getByText("Card"));
    await act(async () => {}); // mint lands
  }

  it("Card mints a checkout session and renders the QR + open link (no fake tap, no save-card)", async () => {
    await openCardStep();

    expect(mockCreatePayment).toHaveBeenCalledTimes(1);
    expect(mockCreatePayment).toHaveBeenCalledWith({ invoiceId: "inv-1" });
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

    expect(mockGetInvoice).toHaveBeenCalledWith({ invoiceId: "inv-1" });
    expect(mockAdoptInvoice).toHaveBeenCalledTimes(1);
    expect(mockAdoptInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inv-1", status: "paid", origin: "db", total: 450 }),
    );
    // Done step (the existing done handling) — no recordPayment double-write:
    // the webhook recorded the money; the poll only adopted the fresh DTO.
    expect(screen.getByText(/Approved · \$450/)).toBeTruthy();
  });

  it("a DRAFT invoice is sent (awaited) BEFORE the session is minted", async () => {
    mockInvoices = [{ ...cardInvoice, status: "draft" } as Invoice];
    let resolveSend!: (v: { ok: boolean; error?: string }) => void;
    mockSendInvoice.mockImplementationOnce(() => new Promise((res) => (resolveSend = res)));
    mockCreatePayment.mockResolvedValue({ url: CHECKOUT_URL });
    mockGetInvoice.mockResolvedValue(paidDto);

    render(<CloseOutModalContent />);
    fireEvent.click(screen.getByText("Take payment — $450"));
    fireEvent.click(screen.getByText("Card"));
    await act(async () => {});

    expect(mockSendInvoice).toHaveBeenCalledWith("inv-1");
    expect(mockCreatePayment).not.toHaveBeenCalled(); // send not resolved yet

    await act(async () => {
      resolveSend({ ok: true });
    });
    expect(mockCreatePayment).toHaveBeenCalledTimes(1);
  });

  it("createPayment PRECONDITION_FAILED shows the server sentence and the record fallback works", async () => {
    const serverSentence =
      "this shop hasn't finished Stripe payment setup — connect Stripe in Settings first";
    mockCreatePayment.mockRejectedValue({
      message: serverSentence,
      data: { code: "PRECONDITION_FAILED" },
    });
    mockGetInvoice.mockResolvedValue(paidDto);

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
