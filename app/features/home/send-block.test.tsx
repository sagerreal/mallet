// @vitest-environment jsdom
/**
 * features/home/send-block.test.tsx
 * THE CLICK, END TO END, ON THE ITEM THE APP ACTUALLY BUILDS.
 *
 * `send.ts` is NOT mocked here — that is the whole point. Every other test of a send surface
 * stubs the primitive, so both of the bugs this file guards lived happily underneath: a queue
 * item's `estimate` is a four-field cast stub with no `fu` (use-ok-queue.ts:95), and the code
 * that read `estimate.fu.stage` threw a TypeError on the click, before anything was dispatched.
 * A shop clicking Send on a real quote reminder got nothing at all.
 *
 * Only the two edges are mocked: the wire (trpcVanilla) and the store.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SendBlock } from "./send-block";
import type { OkItem } from "./derive";
import type { Estimate, Lead } from "@/lib/store/types";

/** `messaging.send`'s input, as the vanilla client is called with it. */
interface SendInput {
  leadId: string;
  body: string;
  idempotencyKey?: string;
}

const wire = vi.hoisted(() => ({
  mutate: vi.fn((input: { leadId: string; body: string; idempotencyKey?: string }) =>
    Promise.resolve(input),
  ),
}));

/** The inputs the wire was actually called with, in order. */
const sentInputs = (): SendInput[] => wire.mutate.mock.calls.map(([input]) => input);

const store = vi.hoisted(() => ({
  addLeadNote: vi.fn(() => ({ id: "note-1" })),
  removeLeadNote: vi.fn(),
  updateEstimate: vi.fn(),
  updateInvoice: vi.fn(),
  updateLead: vi.fn(),
  moveLeadStage: vi.fn(),
  dismissAttention: vi.fn(),
  undismissAttention: vi.fn(),
}));

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: { v1: { messaging: { send: { mutate: wire.mutate } } } },
}));

vi.mock("@/lib/store/app-store", () => {
  const useAppStore = Object.assign((sel: (s: typeof store) => unknown) => sel(store), {
    getState: () => store,
  });
  return { useAppStore, useOpenModal: () => vi.fn() };
});

// A UUID: `dispatchOkSend` skips the wire entirely for store-local ids, which would make the
// assertion below vacuous.
const LEAD_ID = "11111111-1111-4111-8111-111111111111";

const lead: Lead = {
  id: LEAD_ID, name: "Maria Ortiz", phone: "555-0100", source: "web", tags: [], stage: "Quote Sent",
  age: 3, job: "Water heater leaking", last: "",
};

/** Byte-for-byte the object useOkQueue pushes. No `fu` — that is the regression. */
const item: OkItem = {
  key: "okq-e1",
  kind: "quote-viewed",
  lead,
  estimate: { id: "e1", num: "EST-1001", cachedTotal: 2890, lines: [] } as unknown as Estimate,
  value: 2890,
  situation: "read the $2,890 quote",
  editLabel: "Change",
};

const fallback = { leadId: LEAD_ID, first: "Maria", age: 3 };

beforeEach(() => {
  wire.mutate.mockClear();
  for (const fn of Object.values(store)) fn.mockClear();
});

describe("SendBlock — a real queue item", () => {
  it("sends without throwing, and carries the date-salted key", () => {
    render(<SendBlock item={item} fallback={fallback} initial="Hi Maria — checking in." />);

    expect(() => fireEvent.click(screen.getByRole("button", { name: /^send$/i }))).not.toThrow();

    expect(wire.mutate).toHaveBeenCalledTimes(1);
    const sent = sentInputs()[0]!;
    expect(sent.idempotencyKey).toMatch(/^okq-e1-d\d{8}$/);
    expect(sent.body).toBe("Hi Maria — checking in.");
  });

  it("still writes the note the commit is made of", () => {
    render(<SendBlock item={item} fallback={fallback} initial="Hi Maria — checking in." />);
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect(store.addLeadNote).toHaveBeenCalledTimes(1);
    // …and does not invent follow-up state on a record that has none.
    expect(store.updateEstimate).not.toHaveBeenCalled();
  });

  it("a second click the same day reuses the key, so the server can collapse them", () => {
    render(<SendBlock item={item} fallback={fallback} initial="Hi Maria — checking in." />);
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    const first = sentInputs()[0]!.idempotencyKey;

    // The block folds into its ✓ row after a send, so re-render a fresh one — the same card the
    // owner would be looking at after a refetch.
    render(<SendBlock item={item} fallback={fallback} initial="Hi Maria — checking in." />);
    fireEvent.click(screen.getAllByRole("button", { name: /^send$/i })[0]!);
    const second = sentInputs()[1]!.idempotencyKey;

    expect(second).toBe(first);
  });

  it("hands the ledger the inverse and dismisses nothing when the board owns the window", () => {
    const onSent = vi.fn();
    render(
      <SendBlock
        item={item}
        fallback={fallback}
        initial="Hi Maria — checking in."
        ledger={{ onSent, onFailed: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect(wire.mutate).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(store.dismissAttention).not.toHaveBeenCalled();
    // No ✓ row of its own: the caller draws that one.
    expect(screen.queryByText(/✓ sent/)).toBeNull();
  });

  it("dismisses and shows its own ✓ row when nobody else owns the window", () => {
    render(<SendBlock item={item} fallback={fallback} initial="Hi Maria — checking in." />);
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect(store.dismissAttention).toHaveBeenCalledWith("okq-e1");
    expect(screen.getByText(/✓ sent/)).toBeTruthy();
  });
});
