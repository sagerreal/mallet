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
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QuoteLines } from "./QuoteLines";

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
