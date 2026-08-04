// @vitest-environment jsdom
/**
 * components/modals/close-out-card-step.test.tsx
 * The close-out's CARD step is a REAL Stripe Checkout presented as a QR (the old
 * "simulate tap" theater recorded money that was never charged). Contract under test:
 *   - mints the checkout session ONCE on entry (re-renders never double-mint);
 *   - renders the QR + an "Open payment page" anchor (_blank / noreferrer);
 *   - a DRAFT invoice is SENT first — createPayment is only called after sendInvoice
 *     resolves ok (it refuses drafts), and a failed send stops the mint;
 *   - polls the invoice every 4s and hands the fresh record to onPaid on paid/partial,
 *     then stops; transient poll errors keep polling;
 *   - PRECONDITION_FAILED (no Stripe Connect) shows the SERVER's sentence;
 *   - the "They paid another way — record it instead" fallback is ALWAYS visible —
 *     never a dead end — and a 5-minute wall-clock cap lands on a plain sentence.
 *
 * Both the mint and the poll go through lib/store/invoice-write.ts, which picks the office or
 * the field API. The SURFACE is asserted here: a technician holding the QR is refused by every
 * v1.invoicing.* procedure, so a card step that mints against the office router never flips to
 * paid on their screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CardCheckoutStep } from "./close-out-card-step";
import type { InvoiceWriteSurface } from "@/lib/store/invoice-write";
import type { Invoice } from "@/lib/store/types";

const mockCreatePayment = vi.fn<(surface: InvoiceWriteSurface, invoiceId: string) => Promise<{ url: string }>>();
const mockGet = vi.fn<(surface: InvoiceWriteSurface, invoiceId: string) => Promise<Invoice>>();

vi.mock("@/lib/store/invoice-write", () => ({
  mintCheckoutSession: (surface: InvoiceWriteSurface, invoiceId: string) =>
    mockCreatePayment(surface, invoiceId),
  readInvoice: (surface: InvoiceWriteSurface, invoiceId: string) => mockGet(surface, invoiceId),
}));

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,QRTEST") },
}));

const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_a1b2c3";

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    num: "INV-810",
    jobId: "job-1",
    leadId: "lead-1",
    cust: "Dana Alvarez",
    phone: "",
    title: "Fix water heater",
    lines: [{ d: "Fix water heater", q: 1, r: 450 }],
    total: 450,
    depPaid: 0,
    payments: [],
    status: "sent",
    age: 0,
    archived: false,
    origin: "db",
    ...overrides,
  } as Invoice;
}

const sendOk = vi.fn(() => Promise.resolve({ ok: true as const }));

function renderStep(overrides: {
  invoice?: Invoice;
  surface?: InvoiceWriteSurface;
  sendInvoice?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onPaid?: (invoice: Invoice) => void;
  onRecordInstead?: () => void;
  onCancel?: () => void;
} = {}) {
  const props = {
    invoice: overrides.invoice ?? makeInvoice(),
    amount: 450,
    surface: overrides.surface ?? ("office" as InvoiceWriteSurface),
    sendInvoice: overrides.sendInvoice ?? sendOk,
    onPaid: overrides.onPaid ?? vi.fn(),
    onRecordInstead: overrides.onRecordInstead ?? vi.fn(),
    onCancel: overrides.onCancel ?? vi.fn(),
  };
  const view = render(<CardCheckoutStep {...props} />);
  return { ...view, props };
}

describe("CardCheckoutStep — mint once + QR + open link", () => {
  beforeEach(() => {
    mockCreatePayment.mockReset();
    mockGet.mockReset();
    sendOk.mockClear();
  });

  it("mints ONE checkout session and renders the QR + the Open payment page anchor", async () => {
    mockCreatePayment.mockResolvedValue({ url: CHECKOUT_URL });
    mockGet.mockResolvedValue(makeInvoice()); // poll sees "sent" — no advance
    const { rerender, props } = renderStep();
    await act(async () => {});
    // A parent re-render must NOT mint a second session.
    rerender(<CardCheckoutStep {...props} amount={450} />);
    await act(async () => {});

    expect(mockCreatePayment).toHaveBeenCalledTimes(1);
    expect(mockCreatePayment).toHaveBeenCalledWith("office", "inv-1");

    expect(await screen.findByAltText("Payment QR code")).toBeTruthy();
    const link = screen.getByText("Open payment page") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(CHECKOUT_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    // The escape hatch is ALWAYS visible.
    expect(screen.getByText("They paid another way — record it instead")).toBeTruthy();
  });

  it("does not mint for a SENT invoice via sendInvoice (no draft, no send)", async () => {
    mockCreatePayment.mockResolvedValue({ url: CHECKOUT_URL });
    renderStep();
    await act(async () => {});
    expect(sendOk).not.toHaveBeenCalled();
    expect(mockCreatePayment).toHaveBeenCalledTimes(1);
  });
});

describe("CardCheckoutStep — draft invoices are sent BEFORE the session is minted", () => {
  beforeEach(() => {
    mockCreatePayment.mockReset();
    mockGet.mockReset();
  });

  it("awaits sendInvoice ok, THEN calls createPayment (order asserted)", async () => {
    mockCreatePayment.mockResolvedValue({ url: CHECKOUT_URL });
    let resolveSend!: (v: { ok: boolean }) => void;
    const sendInvoice = vi.fn(
      () => new Promise<{ ok: boolean }>((res) => (resolveSend = res)),
    );
    renderStep({ invoice: makeInvoice({ status: "draft" }), sendInvoice });
    await act(async () => {});

    expect(sendInvoice).toHaveBeenCalledWith("inv-1");
    // The send has NOT resolved — no session may exist yet.
    expect(mockCreatePayment).not.toHaveBeenCalled();

    await act(async () => {
      resolveSend({ ok: true });
    });
    expect(mockCreatePayment).toHaveBeenCalledTimes(1);
  });

  it("a failed send stops the mint and surfaces the send error + the record fallback", async () => {
    const sendInvoice = vi.fn(() =>
      Promise.resolve({ ok: false, error: "an invoice needs at least one line" }),
    );
    const onRecordInstead = vi.fn();
    renderStep({ invoice: makeInvoice({ status: "draft" }), sendInvoice, onRecordInstead });
    await act(async () => {});

    expect(mockCreatePayment).not.toHaveBeenCalled();
    expect(screen.getByText("an invoice needs at least one line")).toBeTruthy();
    fireEvent.click(screen.getByText("They paid another way — record it instead"));
    expect(onRecordInstead).toHaveBeenCalledTimes(1);
  });
});

describe("CardCheckoutStep — polling", () => {
  beforeEach(() => {
    mockCreatePayment.mockReset();
    mockGet.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a poll flip to paid hands the fresh record to onPaid and stops the interval", async () => {
    mockCreatePayment.mockResolvedValue({ url: CHECKOUT_URL });
    const paid = makeInvoice({ status: "paid" });
    mockGet.mockResolvedValue(paid);
    const onPaid = vi.fn();
    renderStep({ onPaid });
    await act(async () => {}); // mint lands

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(mockGet).toHaveBeenCalledWith("office", "inv-1");
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(onPaid).toHaveBeenCalledWith(paid);

    // Interval stopped — no further reads, no second onPaid.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(onPaid).toHaveBeenCalledTimes(1);
  });

  it("partial advances the same way (paid-progress)", async () => {
    mockCreatePayment.mockResolvedValue({ url: CHECKOUT_URL });
    const partial = makeInvoice({ status: "partial" });
    mockGet.mockResolvedValue(partial);
    const onPaid = vi.fn();
    renderStep({ onPaid });
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(onPaid).toHaveBeenCalledWith(partial);
  });

  it("transient poll errors are swallowed and polling continues", async () => {
    mockCreatePayment.mockResolvedValue({ url: CHECKOUT_URL });
    mockGet.mockRejectedValue(new Error("network blip"));
    const onPaid = vi.fn();
    renderStep({ onPaid });
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(mockGet).toHaveBeenCalledTimes(2); // kept polling through the failure
    expect(onPaid).not.toHaveBeenCalled();
  });

  it("caps at 5 minutes wall-clock: shows a plain sentence, stops polling, keeps the fallback", async () => {
    mockCreatePayment.mockResolvedValue({ url: CHECKOUT_URL });
    mockGet.mockResolvedValue(makeInvoice()); // stays "sent" forever
    renderStep();
    await act(async () => {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 4_000);
    });
    expect(screen.getByText(/No payment has come through/)).toBeTruthy();
    expect(screen.getByText("They paid another way — record it instead")).toBeTruthy();

    const callsAtCap = mockGet.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(mockGet.mock.calls.length).toBe(callsAtCap); // polling stopped
  });
});

// ---------------------------------------------------------------------------
// The field surface. A technician's token is refused by every v1.invoicing.* procedure, so if
// either of these two calls went to the office router the QR would either never appear or never
// flip to paid — with the customer standing there having already scanned it.
// ---------------------------------------------------------------------------
describe("CardCheckoutStep — a technician's checkout goes to the FIELD API", () => {
  beforeEach(() => {
    mockCreatePayment.mockReset();
    mockGet.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mints AND polls through the field surface, and still flips to paid", async () => {
    mockCreatePayment.mockResolvedValue({ url: CHECKOUT_URL });
    const paid = makeInvoice({ status: "paid" });
    mockGet.mockResolvedValue(paid);
    const onPaid = vi.fn();
    renderStep({ surface: "field", onPaid });
    await act(async () => {});

    expect(mockCreatePayment).toHaveBeenCalledWith("field", "inv-1");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(mockGet).toHaveBeenCalledWith("field", "inv-1");
    expect(onPaid).toHaveBeenCalledWith(paid);
  });
});

describe("CardCheckoutStep — createPayment failure is never a dead end", () => {
  beforeEach(() => {
    mockCreatePayment.mockReset();
    mockGet.mockReset();
  });

  it("PRECONDITION_FAILED renders the SERVER's sentence + the record fallback", async () => {
    const serverSentence =
      "this shop hasn't finished Stripe payment setup — connect Stripe in Settings first";
    mockCreatePayment.mockRejectedValue({
      message: serverSentence,
      data: { code: "PRECONDITION_FAILED" },
    });
    const onRecordInstead = vi.fn();
    renderStep({ onRecordInstead });
    await act(async () => {});

    expect(screen.getByText(serverSentence)).toBeTruthy();
    fireEvent.click(screen.getByText("They paid another way — record it instead"));
    expect(onRecordInstead).toHaveBeenCalledTimes(1);
  });

  it("an unmapped failure falls back to fixed copy (raw provider text never reaches the UI)", async () => {
    mockCreatePayment.mockRejectedValue({
      message: "connect ECONNREFUSED 10.0.0.1:443",
      data: { code: "INTERNAL_SERVER_ERROR" },
    });
    renderStep();
    await act(async () => {});
    expect(screen.queryByText(/ECONNREFUSED/)).toBeNull();
    expect(screen.getByText("Couldn't start the card payment. Try again.")).toBeTruthy();
  });
});
