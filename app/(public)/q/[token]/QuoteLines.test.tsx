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
      changeAlreadyRequested={false}
    />,
  );
}

function checkboxes(): HTMLInputElement[] {
  return screen.getAllByRole("checkbox") as HTMLInputElement[];
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
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Approve — \$1,250/ }));
    });

    expect(screen.getByText(/Approved — thank you!/)).toBeTruthy();
    for (const box of checkboxes()) expect(box.disabled).toBe(true);
    // Totals frozen to the selection that was actually sent.
    expect(screen.getByText(/Total \$1,250/)).toBeTruthy();
    // The selection sent with the POST is the click-time selection.
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({
      action: "accept",
      selectedLineIds: [OPTIONAL_LINES[0]!.id],
    });
  });

  it("a failed accept unlocks the toggles for a retry and shows the server's copy", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "This quote isn't ready to approve yet." }),
    });
    renderLines();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Approve — \$1,000/ }));
    });

    expect(screen.getByText("This quote isn't ready to approve yet.")).toBeTruthy();
    for (const box of checkboxes()) expect(box.disabled).toBe(false);
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
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Approve — \$400/ }));
    });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({
      action: "accept",
      chosenTier: "better",
      selectedLineIds: [OPT_ID],
    });
    expect(screen.getByText(/Approved — thank you!/)).toBeTruthy();
  });

  it("locks the tier cards while an accept is in flight and after approval", async () => {
    let resolveFetch!: (v: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((res) => { resolveFetch = res; }));
    renderTiered();
    fireEvent.click(screen.getByRole("button", { name: /Approve — \$350/ }));

    for (const card of tierCards()) expect(card.disabled).toBe(true);

    await act(async () => {
      resolveFetch({ ok: true, status: 200, json: async () => ({}) });
    });
    for (const card of tierCards()) expect(card.disabled).toBe(true);
  });

  it("surfaces the server's tier-error copy inline and unlocks for a retry", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Choose an option to approve this quote." }),
    });
    renderTiered();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Approve — \$350/ }));
    });
    expect(screen.getByText("Choose an option to approve this quote.")).toBeTruthy();
    for (const card of tierCards()) expect(card.disabled).toBe(false);
  });
});
