// @vitest-environment jsdom
/**
 * THE DEFECT: two complete visit records abutted on `--space-2xs` — 2px. A stepper, a date and a
 * ↩ Reopen ran straight into the next visit's stepper, so the whole section read as one block and
 * the first visit's control looked like the second visit's. The same 2px sat between a placed row
 * and an awaiting-slot row, and between either and the follow-up ask.
 *
 * Separation is the CONTAINER's job — one rule on adjacent siblings — so every combination of
 * rows separates without any row knowing what follows it. That is what these pin.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VisitsSec } from "./visits-sec";
import type { Visit } from "@/lib/store/types";

const visit = (over: Partial<Visit> = {}): Visit => ({
  id: "v1",
  date: "2026-07-12",
  techId: "tech-1",
  start: 11,
  dur: 0.5,
  status: "scheduled",
  ...over,
});

const awaiting = (over: Partial<Visit> = {}): Visit => ({
  id: "a1",
  date: null,
  techId: null,
  start: null,
  dur: 1,
  status: "scheduled",
  ...over,
});

interface SecOver {
  placed?: Visit[];
  awaiting?: Visit[];
  /** The job is finished — the section's other shape. */
  done?: boolean;
  curVisit?: Visit;
  onAddFollowUp?: (reason: string) => Promise<{ ok: boolean; error?: string }>;
}

const sec = (over: SecOver = {}) =>
  render(
    <VisitsSec
      placed={over.placed ?? [visit()]}
      awaiting={over.awaiting ?? []}
      curVisit={over.curVisit}
      done={over.done ?? false}
      isOffice={false}
      stepVisitId={undefined}
      onStatus={vi.fn()}
      onAddFollowUp={over.onAddFollowUp}
    />,
  );

const rowsOf = (container: HTMLElement) => container.querySelector(".vlist")?.children ?? [];

describe("VisitsSec — the rows separate", () => {
  it("puts placed rows, awaiting rows and the follow-up ask in ONE separated list", () => {
    const { container } = sec({
      placed: [visit()],
      awaiting: [awaiting()],
      onAddFollowUp: async () => ({ ok: true }),
    });
    expect(rowsOf(container)).toHaveLength(3);
  });

  it("gives the follow-up ask a plain wrapper — the hairline never lands on the button itself", () => {
    const { container } = sec({ onAddFollowUp: async () => ({ ok: true }) });
    const last = rowsOf(container)[1];
    expect(last?.tagName).toBe("DIV");
    expect(last?.querySelector("button")?.textContent).toBe("Need to come back — add a visit");
  });
});

describe("VisitsSec — a finished job can still book the return", () => {
  // The owner's report, verbatim: "just clicked done and theres no way to add another visit, just
  // take payment." Finishing is exactly when a plumber discovers the fitting is wrong, and this
  // branch used to render the visit he had just finished and nothing else.
  it("offers the ask on a DONE job", () => {
    const { container } = sec({
      done: true,
      curVisit: visit(),
      onAddFollowUp: async () => ({ ok: true }),
    });
    const buttons = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toContain("Need to come back — add a visit");
  });

  it("keeps the finished visit's record above it — the ask is added, not swapped in", () => {
    const { container } = sec({
      placed: [visit({ status: "done" })],
      done: true,
      curVisit: visit({ status: "done" }),
      onAddFollowUp: async () => ({ ok: true }),
    });
    // A finished job has no stop in progress, so no bar is drawn by default — the record is one
    // tap down on the row's own summary. What must NOT happen is the row vanishing.
    expect(container.querySelector(".vstep")).toBeNull();
    expect(screen.getByText(/^Done/)).toBeTruthy();
    fireEvent.click(screen.getByText("Details"));
    expect(container.querySelector(".vstep")).toBeTruthy();
  });

  it("renders no ask when this viewer may not book one", () => {
    const { container } = sec({ done: true, curVisit: visit() });
    const buttons = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).not.toContain("Need to come back — add a visit");
  });
});

describe("VisitsSec — which stop is which", () => {
  it("numbers every visit in the section, placed first then awaiting", () => {
    sec({
      placed: [visit()],
      awaiting: [awaiting({ scopeNotes: "waiting on the part" })],
    });
    expect(screen.getByText("Visit 1 of 2")).toBeTruthy();
    expect(screen.getByText("Visit 2 of 2")).toBeTruthy();
  });

  // The visit rows come off a join with no ORDER BY, so the array order is not a promise. A number
  // printed against an arbitrary order is a lie, so the section orders before it counts.
  it("numbers placed rows in time order, whatever order they arrive in", () => {
    const { container } = sec({
      placed: [
        visit({ id: "late", start: 12 }),
        visit({ id: "early", start: 11 }),
      ],
    });
    const captions = Array.from(container.querySelectorAll(".vseq")).map((n) => n.textContent);
    expect(captions).toEqual(["Visit 1 of 2", "Visit 2 of 2"]);
    expect(container.querySelector(".vlist")?.textContent).toMatch(/Visit 1 of 2[\s\S]*11:00 AM/);
    expect(container.querySelector(".vlist")?.textContent).toMatch(/Visit 2 of 2[\s\S]*12:00 PM/);
  });

  it("numbers nothing when there is only one visit", () => {
    const { container } = sec();
    expect(container.querySelectorAll(".vseq")).toHaveLength(0);
  });

  it("pluralises the heading on a placed + awaiting pair, not just on two placed", () => {
    sec({ placed: [visit()], awaiting: [awaiting()] });
    expect(screen.getByText("Visits")).toBeTruthy();
  });
});
