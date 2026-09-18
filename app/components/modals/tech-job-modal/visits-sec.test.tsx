// @vitest-environment jsdom
/**
 * The visits SLOT: one stepper on screen, arrows between stops, one date line in the pager.
 *
 * What these pin, in the order the design decided them:
 *   - it opens on the stop the job is AT, and finishing a stop advances it
 *   - the pager is the section's ONLY date line (the .vwhen duplicate is what got this built)
 *   - a one-stop job keeps the date line and drops the count and the arrows
 *   - off-screen slides are inert — an invisible ↩ Reopen must not sit in the tab order
 *
 * jsdom has no layout, so `clientWidth` is 0 and the scroll effect no-ops by design — the arrows
 * drive React state directly, which is exactly what these tests exercise.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VisitsSec } from "./visits-sec";
import type { Visit } from "@/lib/store/types";

const visit = (over: Partial<Visit> = {}): Visit =>
  ({
    id: "v1",
    date: "2026-07-12",
    techId: "tech-1",
    start: 11,
    dur: 0.5,
    status: "scheduled",
    ...over,
  }) as Visit;

const awaiting = (over: Partial<Visit> = {}): Visit =>
  ({
    id: "a1",
    date: null,
    techId: null,
    start: null,
    dur: 1,
    status: "scheduled",
    ...over,
  }) as Visit;

interface SecOver {
  placed?: Visit[];
  awaiting?: Visit[];
  done?: boolean;
  curVisit?: Visit;
  isOffice?: boolean;
  stepVisitId?: string;
  onAddFollowUp?: (reason: string) => Promise<{ ok: boolean; error?: string }>;
}

const sec = (over: SecOver = {}) =>
  render(
    <VisitsSec
      placed={over.placed ?? [visit()]}
      awaiting={over.awaiting ?? []}
      curVisit={over.curVisit}
      done={over.done ?? false}
      isOffice={over.isOffice ?? false}
      stepVisitId={over.stepVisitId}
      onStatus={vi.fn()}
      onAddFollowUp={over.onAddFollowUp}
    />,
  );

const caption = () => screen.getByText(/^Visit \d of \d$/).textContent;
const activeSlides = (c: HTMLElement) =>
  Array.from(c.querySelectorAll(".vslide")).filter((s) => !s.hasAttribute("inert"));

describe("VisitsSec — where the slot opens", () => {
  it("opens on the first stop that has not finished", () => {
    sec({
      placed: [visit({ id: "d1", status: "done" }), visit({ id: "s2", start: 15 })],
    });
    expect(caption()).toBe("Visit 2 of 2");
  });

  it("the viewer's own movable stop wins over the job's first open one", () => {
    sec({
      placed: [visit({ id: "s1" }), visit({ id: "s2", start: 15 })],
      stepVisitId: "s2",
    });
    expect(caption()).toBe("Visit 2 of 2");
  });

  it("a return trip waiting on a time IS where the job is once every placed stop finished", () => {
    sec({
      placed: [visit({ id: "d1", status: "done" })],
      awaiting: [awaiting()],
    });
    expect(caption()).toBe("Visit 2 of 2");
    expect(screen.getByText("Return trip — waiting on a time")).toBeTruthy();
  });

  it("a finished job opens on the last stop — the record most likely to be read back", () => {
    sec({
      placed: [visit({ id: "d1", status: "done" }), visit({ id: "d2", start: 15, status: "done" })],
      done: true,
    });
    expect(caption()).toBe("Visit 2 of 2");
  });
});

describe("VisitsSec — the pager", () => {
  it("arrows move between stops and disable at the ends", () => {
    sec({ placed: [visit({ id: "s1" }), visit({ id: "s2", start: 15 })] });
    const prev = screen.getByRole("button", { name: "Previous visit" }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "Next visit" }) as HTMLButtonElement;

    expect(caption()).toBe("Visit 1 of 2");
    expect(prev.disabled).toBe(true);

    fireEvent.click(next);
    expect(caption()).toBe("Visit 2 of 2");
    expect((screen.getByRole("button", { name: "Next visit" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Previous visit" }));
    expect(caption()).toBe("Visit 1 of 2");
  });

  it("carries the section's ONLY date line — the stop's when, once", () => {
    const { container } = sec();
    expect(screen.getByText("Sun 12 · 11:00 AM · ~0h 30m")).toBeTruthy();
    // Exactly one leaf node prints that date — the .vwhen duplicate is what this design deleted.
    expect(
      Array.from(container.querySelectorAll("*")).filter(
        (n) => /Sun 12 · 11:00 AM/.test(n.textContent ?? "") && n.children.length === 0,
      ),
    ).toHaveLength(1);
  });

  it("a one-stop job keeps the date line and drops the count and the arrows", () => {
    sec();
    expect(screen.getByText("Sun 12 · 11:00 AM · ~0h 30m")).toBeTruthy();
    expect(screen.queryByText(/^Visit \d of \d$/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous visit" })).toBeNull();
  });

  it("the line follows the stop you slide to", () => {
    sec({
      placed: [
        visit({
          id: "d1",
          status: "done",
          startedAt: "2026-07-12T18:22:00.000Z",
          completedAt: "2026-07-12T18:56:00.000Z",
        }),
        visit({ id: "s2", start: 15 }),
      ],
    });
    // Lands on the open stop; its line is the booking.
    expect(screen.getByText("Sun 12 · 3:00 PM · ~0h 30m")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Previous visit" }));
    // The finished stop's line is the measured time, never the booked start.
    expect(screen.getByText("Sun 12 · 0h 34m on site")).toBeTruthy();
  });
});

describe("VisitsSec — one stepper on screen", () => {
  it("every stop keeps its record mounted, but only the shown slide is reachable", () => {
    const { container } = sec({
      placed: [visit({ id: "d1", status: "done" }), visit({ id: "s2", start: 15 })],
      isOffice: true,
    });
    // Both steppers exist — the record is never thrown away…
    expect(container.querySelectorAll(".vstep")).toHaveLength(2);
    // …but exactly one slide is live, and the finished stop's ↩ Reopen sits inert off-screen.
    expect(activeSlides(container)).toHaveLength(1);
    expect(activeSlides(container)[0]!.querySelector("[aria-label='Visit 2 progress']")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Previous visit" }));
    expect(activeSlides(container)[0]!.querySelector("[aria-label='Visit 1 progress']")).toBeTruthy();
    expect(activeSlides(container)[0]!.textContent).toContain("↩ Reopen");
  });

  it("finishing the shown stop advances the slot to the next one", () => {
    const first = visit({ id: "s1" });
    const { rerender } = render(
      <VisitsSec
        placed={[first, visit({ id: "s2", start: 15 })]}
        awaiting={[]}
        curVisit={first}
        done={false}
        isOffice={false}
        stepVisitId="s1"
        onStatus={vi.fn()}
      />,
    );
    expect(caption()).toBe("Visit 1 of 2");

    // The tap lands: stop 1 is done, the viewer's movable visit is now stop 2.
    rerender(
      <VisitsSec
        placed={[visit({ id: "s1", status: "done" }), visit({ id: "s2", start: 15 })]}
        awaiting={[]}
        curVisit={visit({ id: "s2", start: 15 })}
        done={false}
        isOffice={false}
        stepVisitId="s2"
        onStatus={vi.fn()}
      />,
    );
    expect(caption()).toBe("Visit 2 of 2");
  });
});

describe("VisitsSec — the follow-up ask and the empty state", () => {
  it("offers the ask on a DONE job — finishing is when the wrong fitting turns up", () => {
    const { container } = sec({
      placed: [visit({ status: "done" })],
      done: true,
      onAddFollowUp: async () => ({ ok: true }),
    });
    const buttons = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toContain("Need to come back — add a visit");
    // The finished stop's record is right there above it — nothing vanished.
    expect(container.querySelector(".vstep")).toBeTruthy();
  });

  it("renders no ask when this viewer may not book one", () => {
    const { container } = sec({ done: true });
    const buttons = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).not.toContain("Need to come back — add a visit");
  });

  it("says so plainly when nothing is scheduled at all", () => {
    sec({ placed: [], awaiting: [] });
    expect(screen.getByText("Not scheduled yet — the office will set the time.")).toBeTruthy();
  });

  it("pluralises the heading on a placed + awaiting pair, not just on two placed", () => {
    sec({ placed: [visit()], awaiting: [awaiting()] });
    expect(screen.getByText("Visits")).toBeTruthy();
  });
});
