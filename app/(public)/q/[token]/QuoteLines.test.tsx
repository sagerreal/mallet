// @vitest-environment jsdom
/**
 * app/(public)/q/[token]/QuoteLines.test.tsx
 *
 * Guards the money-critical lock between the add-on toggles and the accept flow:
 *   - toggling an add-on updates the total + the Approve button amount
 *   - the moment Approve is tapped (busy) the checkboxes lock — no mid-flight
 *     divergence between the displayed and the committed total
 *   - after a successful accept the page freezes: approved banner, checkboxes
 *     stay disabled forever, total keeps showing the committed amount
 *   - a failed accept unlocks the toggles again (retry is possible)
 *
 * Good/Better/Best mode (tiers prop present):
 *   - three tier cards, recommended selected by default + labeled "Recommended"
 *   - switching tiers swaps the fixed lines, recomputes the total, and clears
 *     the optional add-on selection (ids are scoped to a tier)
 *   - accept POSTs { chosenTier, selectedLineIds }
 *   - the tier cards obey the SAME lock as the add-on toggles
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QuoteLines, type TierLinesView } from "./QuoteLines";

const TOKEN = "a".repeat(64);

const OPTIONAL_LINES = [
  { id: "11111111-1111-1111-1111-111111111111", description: "Expansion tank", quantity: 1, rateCents: 25_000 },
  { id: "22222222-2222-2222-2222-222222222222", description: "Haul-away", quantity: 1, rateCents: 5_000 },
];

function renderLines() {
  return render(
    <QuoteLines
      fixedSubtotalCents={100_000}
      optionalLines={OPTIONAL_LINES}
      discBps={0}
      taxBps={0}
      depBps={0}
      token={TOKEN}
      orgName="Bay Plumbing"
      changeAlreadyRequested={false}
    />,
  );
}

function checkboxes(): HTMLInputElement[] {
  return screen.getAllByRole("checkbox") as HTMLInputElement[];
}

/**
 * Walk the full approve flow: press Approve, fill in the signature panel, submit.
 *
 * Approve no longer POSTs — it reveals the signing panel, and the POST happens on "Sign &
 * approve". Every accept test goes through here so the two-step is exercised rather than
 * stubbed around.
 *
 * The drawn mark is two pointer events. jsdom reports a zero-size box so every coordinate is
 * 0,0 — the path still contains an "L", which is all the pad requires to treat it as a stroke
 * rather than a stray tap.
 */
function drawSignature() {
  const pad = screen.getByRole("img", { name: "Draw your signature" });
  // jsdom does no layout, so every box is 0x0 and the pad correctly refuses to record points it
  // cannot scale. Give it a real box so the coordinate maths has something to divide by.
  pad.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 600, height: 180, right: 600, bottom: 180, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  fireEvent.pointerDown(pad, { clientX: 10, clientY: 10 });
  fireEvent.pointerMove(pad, { clientX: 40, clientY: 30 });
  fireEvent.pointerUp(pad);
}

function fillSignature(name = "Dave Chen") {
  fireEvent.change(screen.getByLabelText(/Your full name/), { target: { value: name } });
  drawSignature();
}

function signButton(): HTMLElement {
  return screen.getByRole("button", { name: /Sign & approve/ });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QuoteLines — add-on toggles + totals", () => {
  it("toggling an add-on updates the total and the Approve amount", () => {
    renderLines();
    expect(screen.getByText(/Total \$1,000/)).toBeTruthy();
    fireEvent.click(checkboxes()[0]!); // +$250 expansion tank
    expect(screen.getByText(/Total \$1,250/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Approve — \$1,250/ })).toBeTruthy();
  });
});

describe("QuoteLines — accept locks the toggles", () => {
  it("disables the checkboxes the moment Approve is tapped (mid-flight lock)", async () => {
    let resolveFetch!: (v: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((res) => { resolveFetch = res; }));
    renderLines();
    fireEvent.click(checkboxes()[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Approve — \$1,250/ }));
    // Locked from the moment the panel opens, before anything is in flight: the sentence in the
    // panel names $1,250 and a toggle would silently change what is being signed.
    for (const box of checkboxes()) expect(box.disabled).toBe(true);
    fillSignature();
    fireEvent.click(signButton());

    // In flight: every toggle is locked.
    for (const box of checkboxes()) expect(box.disabled).toBe(true);

    await act(async () => {
      resolveFetch({ ok: true, status: 200, json: async () => ({}) });
    });
  });

  it("after a successful accept the toggles stay locked and the committed total stays on screen", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    renderLines();
    fireEvent.click(checkboxes()[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Approve — \$1,250/ }));
    fillSignature();
    await act(async () => {
      fireEvent.click(signButton());
    });

    expect(screen.getByText(/Approved — thank you!/)).toBeTruthy();
    for (const box of checkboxes()) expect(box.disabled).toBe(true);
    // Totals frozen to the selection that was actually sent.
    expect(screen.getByText(/Total \$1,250/)).toBeTruthy();
    // The selection sent with the POST is the click-time selection.
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({
      action: "accept",
      selectedLineIds: [OPTIONAL_LINES[0]!.id],
      signerName: "Dave Chen",
    });
    // The mark is real path data, not an empty string the server would reject.
    expect(body.signatureSvg).toMatch(/^M[\d.,]+ L/);
  });

  it("a failed accept unlocks the toggles for a retry and shows the server's copy", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "This quote isn't ready to approve yet." }),
    });
    renderLines();
    fireEvent.click(screen.getByRole("button", { name: /Approve — \$1,000/ }));
    fillSignature();
    await act(async () => {
      fireEvent.click(signButton());
    });

    expect(screen.getByText("This quote isn't ready to approve yet.")).toBeTruthy();
    // Not a signature problem, so the panel closes and the selection is editable again — there is
    // nothing to fix inside the panel when the quote itself isn't approvable.
    for (const box of checkboxes()) expect(box.disabled).toBe(false);
    // ...but reopening it finds the name and mark still there, so nothing is redrawn.
    fireEvent.click(screen.getByRole("button", { name: /Approve — \$1,000/ }));
    expect((screen.getByLabelText(/Your full name/) as HTMLInputElement).value).toBe("Dave Chen");
  });
});

// ---------------------------------------------------------------------------
// Good/Better/Best mode
// ---------------------------------------------------------------------------

const OPT_ID = "33333333-3333-3333-3333-333333333333";

const TIERS: readonly TierLinesView[] = [
  {
    tier: "good",
    name: "Patch",
    fixedLines: [
      { id: "44444444-4444-4444-4444-444444444444", description: "Patch leak", quantity: 1, rateCents: 20_000 },
    ],
    optionalLines: [],
    totalCents: 20_000,
  },
  {
    tier: "better",
    name: "Repair",
    fixedLines: [
      { id: "55555555-5555-5555-5555-555555555555", description: "Repair section", quantity: 1, rateCents: 35_000 },
    ],
    optionalLines: [
      { id: OPT_ID, description: "Camera inspection", quantity: 1, rateCents: 5_000 },
    ],
    totalCents: 35_000,
  },
  {
    tier: "best",
    name: "Replace",
    fixedLines: [
      { id: "66666666-6666-6666-6666-666666666666", description: "Replace run", quantity: 1, rateCents: 90_000 },
    ],
    optionalLines: [],
    totalCents: 90_000,
  },
];

function renderTiered() {
  return render(
    <QuoteLines
      tiers={TIERS}
      recommendedTier="better"
      discBps={0}
      taxBps={0}
      depBps={0}
      token={TOKEN}
      orgName="Bay Plumbing"
      changeAlreadyRequested={false}
    />,
  );
}

function tierCards(): HTMLButtonElement[] {
  return screen.getAllByRole("radio") as HTMLButtonElement[];
}

describe("QuoteLines — Good/Better/Best picker", () => {
  it("renders three cards, recommended selected by default and labeled", () => {
    renderTiered();
    const cards = tierCards();
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(screen.getByText("Recommended")).toBeTruthy();
    // The recommended tier's lines + total render by default.
    expect(screen.getByText("Repair section")).toBeTruthy();
    expect(screen.getByText(/Total \$350/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Approve — \$350/ })).toBeTruthy();
  });

  it("switching tiers swaps the lines and recomputes the total + Approve amount", () => {
    renderTiered();
    fireEvent.click(screen.getByRole("radio", { name: /Replace/ }));
    expect(screen.getByText("Replace run")).toBeTruthy();
    expect(screen.queryByText("Repair section")).toBeNull();
    expect(screen.getByText(/Total \$900/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Approve — \$900/ })).toBeTruthy();
  });

  it("switching tiers clears the optional add-on selection (ids are tier-scoped)", () => {
    renderTiered();
    fireEvent.click(checkboxes()[0]!); // camera add-on on Repair → $400
    expect(screen.getByText(/Total \$400/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Patch/ }));
    expect(screen.getByText(/Total \$200/)).toBeTruthy();
    // Back on Repair: the add-on is unchecked again.
    fireEvent.click(screen.getByRole("radio", { name: /Repair/ }));
    expect(screen.getByText(/Total \$350/)).toBeTruthy();
    expect((checkboxes()[0] as HTMLInputElement).checked).toBe(false);
  });

  it("accept POSTs the chosen tier + the selected add-on ids scoped to it", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    renderTiered();
    fireEvent.click(checkboxes()[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Approve — \$400/ }));
    fillSignature();
    await act(async () => {
      fireEvent.click(signButton());
    });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({
      action: "accept",
      chosenTier: "better",
      selectedLineIds: [OPT_ID],
      signerName: "Dave Chen",
    });
    expect(screen.getByText(/Approved — thank you!/)).toBeTruthy();
  });

  it("locks the tier cards while an accept is in flight and after approval", async () => {
    let resolveFetch!: (v: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((res) => { resolveFetch = res; }));
    renderTiered();
    fireEvent.click(screen.getByRole("button", { name: /Approve — \$350/ }));
    // Locked as soon as the panel opens — switching tier would change the amount being signed.
    for (const card of tierCards()) expect(card.disabled).toBe(true);
    fillSignature();
    fireEvent.click(signButton());

    for (const card of tierCards()) expect(card.disabled).toBe(true);

    await act(async () => {
      resolveFetch({ ok: true, status: 200, json: async () => ({}) });
    });
    for (const card of tierCards()) expect(card.disabled).toBe(true);
  });

  it("with ONE real tier: hides the picker and renders that tier as a single quote — accept still carries its tier", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    render(
      <QuoteLines
        tiers={[TIERS[1]!]}
        recommendedTier="better"
        discBps={0}
        taxBps={0}
        depBps={0}
        token={TOKEN}
        orgName="Bay Plumbing"
        changeAlreadyRequested={false}
      />,
    );

    // No picker, no "Choose an option" heading — nothing to choose.
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText("Choose an option")).toBeNull();
    // The surviving tier's lines + total render like a single quote.
    expect(screen.getByText("Repair section")).toBeTruthy();
    expect(screen.getByText(/Total \$350/)).toBeTruthy();

    // Accept still names the tier — the server requires a tier choice to
    // resolve a tiered estimate.
    fireEvent.click(screen.getByRole("button", { name: /Approve — \$350/ }));
    fillSignature();
    await act(async () => {
      fireEvent.click(signButton());
    });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ action: "accept", chosenTier: "better", signerName: "Dave Chen" });
  });

  it("surfaces the server's tier-error copy inline and unlocks for a retry", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Choose an option to approve this quote." }),
    });
    renderTiered();
    fireEvent.click(screen.getByRole("button", { name: /Approve — \$350/ }));
    fillSignature();
    await act(async () => {
      fireEvent.click(signButton());
    });
    expect(screen.getByText("Choose an option to approve this quote.")).toBeTruthy();
    // The tier cards unlock so the customer can pick a different option and retry — a server
    // rejection of the CHOICE has to give the choice back.
    for (const card of tierCards()) expect(card.disabled).toBe(false);
  });
});

describe("QuoteLines — signing", () => {
  it("approves with a TYPED NAME ONLY — no drawing required", async () => {
    // The path most customers will actually take, and the one that has to work for anyone who
    // cannot draw at all. Requiring the squiggle would block them; the typed name is the
    // signature (see modules/quoting/domain/signature.ts).
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    renderLines();
    fireEvent.click(screen.getByRole("button", { name: /Approve — \$1,000/ }));
    fireEvent.change(screen.getByLabelText(/Your full name/), { target: { value: "Dave Chen" } });

    await act(async () => {
      fireEvent.click(signButton());
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.signerName).toBe("Dave Chen");
    // Omitted entirely, not sent as "" — "signed by typing their name" is a different record
    // from "drew nothing", and the route's schema rejects an empty string outright.
    expect(body).not.toHaveProperty("signatureSvg");
    expect(screen.getByText(/Approved — thank you!/)).toBeTruthy();
  });

  it("refuses to submit with an empty name and never calls the server", () => {
    renderLines();
    fireEvent.click(screen.getByRole("button", { name: /Approve — \$1,000/ }));
    fireEvent.click(signButton());

    expect(screen.getByText("Type your name to sign.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the amount and the shop inside the sentence being signed", () => {
    // The sentence is the thing under dispute, so it has to name both — and it must match what
    // the server stores, which is why both sides call the same function.
    renderLines();
    fireEvent.click(screen.getByRole("button", { name: /Approve — \$1,000/ }));
    expect(screen.getByText(/I authorize Bay Plumbing to perform the work/)).toBeTruthy();
    expect(screen.getByText(/\$1,000\.00/)).toBeTruthy();
    expect(screen.getByText(/both the quote and the final bill/)).toBeTruthy();
  });

  it("Approve alone does NOT approve — it opens the panel and posts nothing", () => {
    // The two-step is the deliberate act. A single click that both opened and submitted would be
    // the click-to-approve this feature replaces.
    renderLines();
    fireEvent.click(screen.getByRole("button", { name: /Approve — \$1,000/ }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(signButton()).toBeTruthy();
  });

  it("Back closes the panel and keeps what was already typed", () => {
    renderLines();
    fireEvent.click(screen.getByRole("button", { name: /Approve — \$1,000/ }));
    fireEvent.change(screen.getByLabelText(/Your full name/), { target: { value: "Dave Chen" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    // Toggles usable again...
    for (const box of checkboxes()) expect(box.disabled).toBe(false);
    // ...and reopening finds the name still there.
    fireEvent.click(screen.getByRole("button", { name: /Approve — \$1,000/ }));
    expect((screen.getByLabelText(/Your full name/) as HTMLInputElement).value).toBe("Dave Chen");
  });
});

describe("QuoteLines — a settled quote is a record, not an offer", () => {
  it("keeps the lines and total but drops every action button", () => {
    render(
      <QuoteLines
        fixedSubtotalCents={100_000}
        optionalLines={OPTIONAL_LINES}
        discBps={0}
        taxBps={0}
        depBps={0}
        token={TOKEN}
        orgName="Bay Plumbing"
        changeAlreadyRequested={false}
        settled
      />,
    );

    // The record survives — this is the ESIGN § 7001(e) retainability point: the customer must
    // still be able to read what they agreed to.
    expect(screen.getByText(/Total \$1,000/)).toBeTruthy();
    expect(screen.getByText("Expansion tank")).toBeTruthy();

    // No second decision on offer. No Approve, no decline, no request-a-change.
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("locks the add-on toggles so the displayed total cannot be edited after the fact", () => {
    render(
      <QuoteLines
        fixedSubtotalCents={100_000}
        optionalLines={OPTIONAL_LINES}
        discBps={0}
        taxBps={0}
        depBps={0}
        token={TOKEN}
        orgName="Bay Plumbing"
        changeAlreadyRequested={false}
        settled
      />,
    );

    for (const box of checkboxes()) expect(box.disabled).toBe(true);
    fireEvent.click(checkboxes()[0]!);
    expect(screen.getByText(/Total \$1,000/)).toBeTruthy(); // unchanged
  });

  it("locks the tier cards on a settled tiered quote", () => {
    render(
      <QuoteLines
        tiers={TIERS}
        recommendedTier="better"
        discBps={0}
        taxBps={0}
        depBps={0}
        token={TOKEN}
        orgName="Bay Plumbing"
        changeAlreadyRequested={false}
        settled
      />,
    );
    for (const card of tierCards()) expect(card.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });
});
