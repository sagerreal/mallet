// @vitest-environment jsdom
/**
 * features/home/handoff-note.test.tsx
 * The hero's SENTENCE. Every clause here is read as a statement of fact by the person who owns the
 * shop, so the tests are about what the words claim, not how they look.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HandoffNote, queueClause } from "./handoff-note";
import type { ShiftReport } from "./derive";

/** A report with nothing in it — the real shape, not a cast, so a field added later shows up here. */
const QUIET: ShiftReport = { callsAnswered: 0, booked: null, receipts: [], busy: false };

const base = {
  orgName: "Rivera Plumbing",
  ownerFirst: "Owen",
  dateLabel: "FRI, AUG 7",
  frontDeskOn: false,
  report: QUIET,
};

describe("queueClause — what is waiting, in words", () => {
  it("no textsReady at all: the original sentence, unchanged, for every caller that isn't the board", () => {
    expect(queueClause(3)).toBe("three texts below, ready to send.");
    expect(queueClause(1)).toBe("one text below, ready to send.");
  });

  it("the board's two figures read as two facts", () => {
    expect(queueClause(35, 6)).toBe("35 items · 6 texts ready to send.");
  });

  // "0 texts ready to send" is a negative nobody asked about — it reads as a failure rather than a
  // fact, and the item count alone is the whole truth.
  it("no drafts ready: the clause is dropped, not stated as zero", () => {
    expect(queueClause(12, 0)).toBe("12 items.");
    expect(queueClause(12, 0)).not.toContain("0 texts");
  });

  it("one of a thing is singular — never '1 items' or '1 texts'", () => {
    expect(queueClause(1, 1)).toBe("1 item · 1 text ready to send.");
  });
});

describe("HandoffNote — the loading gate", () => {
  // The one sentence the app must never write from figures it hasn't got.
  it("loading: the thesis is a skeleton, never the confident zero-state", () => {
    render(<HandoffNote {...base} queueCount={0} queueValue={0} textsReady={0} loading />);
    expect(screen.queryByText(/Nothing's waiting on you/)).toBeNull();
    expect(screen.getByText(/Loading today/)).toBeTruthy();
    // Identity is server-seeded, so it stays up while the figures are unknown.
    expect(screen.getByText(/Owen/)).toBeTruthy();
  });

  it("settled and genuinely empty: the sign-off, with no queue sentence", () => {
    render(<HandoffNote {...base} queueCount={0} queueValue={0} textsReady={0} />);
    expect(screen.getByText(/Nothing's waiting on you/)).toBeTruthy();
  });

  it("settled with work waiting: the figure is the subject and the clause states both counts", () => {
    render(<HandoffNote {...base} queueCount={35} queueValue={5310} textsReady={6} />);
    expect(screen.getByLabelText("$5,310 waiting on your OK")).toBeTruthy();
    expect(screen.getByText(/35 items · 6 texts ready to send\./)).toBeTruthy();
  });
});
