// @vitest-environment jsdom
/**
 * The row's ONE BIG FIGURE, and its index.
 *
 * THE DEFECT: a finished visit printed the time it was BOOKED, in the largest text on the row,
 * directly under a stepper saying the technician actually arrived at 9:22p. The row contradicted
 * itself, and the booked start was already on the stepper's own Scheduled node — so the headline
 * was both the least useful figure available and a duplicate of one two lines above it.
 *
 * Its sibling defect: two complete visit records, each a stepper and a date and possibly a
 * button, were unnumbered — so nothing on a two-visit sheet said which stop was which.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VisitRow } from "./visit-row";
import type { Visit } from "@/lib/store/types";

/** 11:00 AM, half an hour booked — the owner's own two-visit job. */
const visit = (over: Partial<Visit> = {}): Visit => ({
  id: "v1",
  date: "2026-07-12",
  techId: "tech-1",
  start: 11,
  dur: 0.5,
  status: "scheduled",
  ...over,
});

const row = (v: Visit, seq?: { n: number; of: number }) =>
  render(<VisitRow visit={v} seq={seq} canReopen={false} canStep={false} onStatus={vi.fn()} />);

describe("VisitRow — the one big figure", () => {
  it("leads with the appointment before the visit has started", () => {
    row(visit());
    expect(screen.getByText("Sun 12 · 11:00 AM")).toBeTruthy();
    expect(screen.getByText("about 0h 30m on site")).toBeTruthy();
  });

  it("a DONE visit leads with the time actually spent, never the booked start", () => {
    row(
      visit({
        status: "done",
        startedAt: "2026-07-12T16:22:00.000Z",
        completedAt: "2026-07-12T16:56:00.000Z",
      }),
    );
    expect(screen.getByText("On site 0h 34m")).toBeTruthy();
    // The booked start is the stepper's Scheduled node's job; it is not the headline.
    expect(screen.queryByText(/11:00 AM/)).toBeNull();
    // …and the booked length is still there, labelled as the plan it is.
    expect(screen.getByText("Sun 12 · ~0h 30m booked")).toBeTruthy();
  });

  it("a DONE visit nobody clocked into shows the day — it never invents a duration", () => {
    row(visit({ status: "done", completedAt: "2026-07-12T16:56:00.000Z" }));
    expect(screen.getByText("Sun 12")).toBeTruthy();
    expect(screen.queryByText(/^On site \d/)).toBeNull();
    expect(screen.queryByText(/11:00 AM/)).toBeNull();
  });

  it("refuses a negative span rather than printing one", () => {
    row(
      visit({
        status: "done",
        startedAt: "2026-07-12T16:56:00.000Z",
        completedAt: "2026-07-12T16:22:00.000Z",
      }),
    );
    expect(screen.getByText("Sun 12")).toBeTruthy();
    expect(screen.queryByText(/^On site \d/)).toBeNull();
  });
});

describe("VisitRow — which stop is this", () => {
  it("numbers the row, on screen and in the stepper's accessible name", () => {
    row(visit(), { n: 2, of: 2 });
    expect(screen.getByText("Visit 2 of 2")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Visit 2 progress" })).toBeTruthy();
  });

  it("says nothing at all when there is only one visit to tell apart", () => {
    row(visit());
    expect(screen.queryByText(/^Visit \d/)).toBeNull();
    expect(screen.getByRole("list", { name: "Visit progress" })).toBeTruthy();
  });
});
