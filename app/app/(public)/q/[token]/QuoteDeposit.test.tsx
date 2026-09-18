// @vitest-environment jsdom
/**
 * app/(public)/q/[token]/QuoteDeposit.test.tsx
 *
 * The "Pay the deposit" primary on the public quote page.
 *
 * It exists in exactly two places, and both are covered here because a customer reaches the
 * deposit by two different routes:
 *   - they approve in this session (QuoteActions' approved state), and
 *   - they come back to the link later (QuoteLines' settled state — QuoteActions is gone by then).
 *
 * The rules the button must obey: only after approval, only while something is still owed, and
 * only when the shop can actually take a card. A button that always errors is worse than no
 * button, so each of those is a NON-render assertion, not a disabled one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QuoteLines } from "./QuoteLines";

const TOKEN = "b".repeat(64);
const PAY_BUTTON = /Pay the deposit/;

let fetchMock: ReturnType<typeof vi.fn>;
let assignMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  assignMock = vi.fn();
  // jsdom refuses real navigation; swap the location object for a recorder.
  vi.stubGlobal("location", { href: "http://localhost/", assign: assignMock });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Options {
  readonly settled?: boolean;
  readonly payableDepositCents?: number;
  readonly cardPaymentAvailable?: boolean;
  readonly depBps?: number;
  readonly fixedSubtotalCents?: number;
}

function renderQuote(options: Options = {}) {
  return render(
    <QuoteLines
      fixedSubtotalCents={options.fixedSubtotalCents ?? 100_000}
      fixedTaxableCents={options.fixedSubtotalCents ?? 100_000}
      optionalLines={[]}
      discBps={0}
      taxBps={0}
      depBps={options.depBps ?? 3_000}
      token={TOKEN}
      orgName="Bay Plumbing"
      changeAlreadyRequested={false}
      settled={options.settled ?? false}
      payableDepositCents={options.payableDepositCents ?? 0}
      cardPaymentAvailable={options.cardPaymentAvailable ?? true}
    />,
  );
}

/** Approve in-session: reveal the signing panel, type a name, submit. */
async function approve() {
  fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
  fireEvent.change(screen.getByLabelText(/Your full name/), { target: { value: "Dana Reyes" } });
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Sign & approve/ }));
  });
}

describe("pay-the-deposit primary — when it appears", () => {
  it("is absent before approval", () => {
    renderQuote();
    expect(screen.queryByRole("button", { name: PAY_BUTTON })).toBeNull();
  });

  it("appears right after an in-session approval, naming the amount owed", async () => {
    renderQuote();
    await approve();
    expect(screen.getByRole("button", { name: PAY_BUTTON }).textContent).toContain("$300.00");
  });

  it("is absent after approval when the quote asks for no deposit", async () => {
    renderQuote({ depBps: 0 });
    await approve();
    expect(screen.queryByRole("button", { name: PAY_BUTTON })).toBeNull();
  });

  it("is absent after approval when the shop cannot take cards", async () => {
    renderQuote({ cardPaymentAvailable: false });
    await approve();
    expect(screen.queryByRole("button", { name: PAY_BUTTON })).toBeNull();
  });

  // The two directions of the card-minimum floor. The post-approval branch used to apply only
  // "cardPaymentAvailable && deposit > 0" while the page and the server both applied the 50¢
  // minimum, so a sub-minimum deposit rendered a button the checkout would always refuse.
  it("is absent after approval when the deposit is under the card minimum", async () => {
    // $1.00 of work at 30% = 30¢, under the 50¢ USD Checkout minimum.
    renderQuote({ fixedSubtotalCents: 100 });
    await approve();
    expect(screen.queryByRole("button", { name: PAY_BUTTON })).toBeNull();
  });

  it("appears after approval at exactly the card minimum", async () => {
    // $1.67 at 30% = 50.1¢ → 50¢ after the domain's rounding: payable, and it must be offered.
    renderQuote({ fixedSubtotalCents: 167 });
    await approve();
    expect(screen.getByRole("button", { name: PAY_BUTTON }).textContent).toContain("$0.50");
  });

  it("is absent on a return visit when the deposit is under the card minimum", () => {
    // The page zeroes it through the same predicate, so nothing renders here either.
    renderQuote({ settled: true, payableDepositCents: 0 });
    expect(screen.queryByRole("button", { name: PAY_BUTTON })).toBeNull();
  });

  it("appears on a return visit to an accepted quote with the deposit still owed", () => {
    renderQuote({ settled: true, payableDepositCents: 30_000 });
    expect(screen.getByRole("button", { name: PAY_BUTTON }).textContent).toContain("$300.00");
  });

  it("is absent on a return visit once the deposit is paid", () => {
    renderQuote({ settled: true, payableDepositCents: 0 });
    expect(screen.queryByRole("button", { name: PAY_BUTTON })).toBeNull();
  });

  it("does not restate the deposit sentence — the totals line already says it", () => {
    renderQuote({ settled: true, payableDepositCents: 30_000 });
    // One statement of the ask (the totals line), one call to action (the button). The button
    // carries the amount because a primary must name what it charges, but it must not repeat the
    // "deposit due today · the rest when the job's done" sentence sitting directly above it.
    expect(screen.getByText(/deposit due today/)).toBeTruthy();
    const label = screen.getByRole("button", { name: PAY_BUTTON }).textContent ?? "";
    expect(label).toContain("$300.00");
    expect(label).not.toMatch(/due today|the rest when/);
  });
});

describe("pay-the-deposit primary — what it does", () => {
  it("POSTs create_deposit_checkout and hands the customer to the returned URL", async () => {
    renderQuote({ settled: true, payableDepositCents: 30_000 });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: "https://checkout.stripe.com/c/pay/cs_dep_1" }),
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: PAY_BUTTON }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/public/quote/${TOKEN}`,
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ action: "create_deposit_checkout" });
    expect(assignMock).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_dep_1");
  });

  it("shows the server's own copy when the deposit cannot be started, and stays put", async () => {
    renderQuote({ settled: true, payableDepositCents: 30_000 });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "This business can't take card payments online right now — contact them to pay the deposit." }),
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: PAY_BUTTON }));
    });

    expect(screen.getByRole("alert").textContent).toMatch(/contact them to pay the deposit/);
    expect(assignMock).not.toHaveBeenCalled();
    // Still offered — the customer can retry once the shop fixes its side.
    expect(screen.getByRole("button", { name: PAY_BUTTON })).toBeTruthy();
  });

  it("cannot double-fire: the button locks while the checkout is being minted", async () => {
    renderQuote({ settled: true, payableDepositCents: 30_000 });
    let resolveFetch!: (v: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((res) => { resolveFetch = res; }));

    const button = screen.getByRole("button", { name: PAY_BUTTON }) as HTMLButtonElement;
    fireEvent.click(button);
    expect((screen.getByRole("button", { name: /Opening secure checkout/ }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveFetch({ ok: true, status: 200, json: async () => ({ url: "https://checkout.stripe.com/x" }) });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
