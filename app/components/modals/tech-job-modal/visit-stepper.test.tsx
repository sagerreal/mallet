// @vitest-environment jsdom
/**
 * The stepper as a CONTROL. It was built as a pure readout, and the readout half is pinned in
 * visit-steps.test.ts; this pins the half that moves the visit.
 *
 * THE DEFECT: a technician forgot to tap "Start driving" and was already at the door. The foot's
 * ladder offers "I've arrived →" only once the visit is enroute (tech-job-foot.ts), so the sheet
 * had no way to record what had actually happened — even though the backend has always allowed
 * pending → in_progress. The nodes ahead of the visit are now the shortcut.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VisitStepper } from "./visit-stepper";
import type { Visit } from "@/lib/store/types";

const visit = (over: Partial<Visit> = {}): Visit => ({
  id: "v1",
  date: "2026-08-04",
  techId: "tech-1",
  start: 15,
  dur: 2,
  status: "scheduled",
  ...over,
});

const buttonLabels = () =>
  screen.queryAllByRole("button").map((b) => b.textContent?.replace(/,.*/, "").trim());

describe("VisitStepper — forward jumps", () => {
  it("skips straight to On site from scheduled — the owner's actual request", () => {
    const onJump = vi.fn();
    render(<VisitStepper visit={visit()} onJump={onJump} />);

    fireEvent.click(screen.getByRole("button", { name: /On site/ }));

    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith("onsite");
  });

  it("still offers the ordinary next step too", () => {
    const onJump = vi.fn();
    render(<VisitStepper visit={visit()} onJump={onJump} />);

    fireEvent.click(screen.getByRole("button", { name: /On the way/ }));

    expect(onJump).toHaveBeenCalledWith("enroute");
  });

  it("from enroute, On site AND Done are live — Scheduled is behind the visit", () => {
    render(<VisitStepper visit={visit({ status: "enroute", enrouteAt: "2026-08-04T18:41:00Z" })} onJump={vi.fn()} />);
    // Done is the fourth node and a forward jump like the others: three dots responding and a
    // fourth that does not reads as broken. The foot keeps its own Finish primary.
    expect(buttonLabels()).toEqual(["On site", "Done"]);
  });

  // Backwards is not refused, it is absent. Un-finishing a visit rewrites hours somebody may
  // already have been paid for — that is the office's ↩ Reopen, never a tap in a truck.
  it("offers NOTHING on a done visit, skipped nodes included", () => {
    render(<VisitStepper visit={visit({ status: "done" })} onJump={vi.fn()} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    // …and BOTH skipped steps are still visibly skipped, not quietly backfilled.
    expect(screen.getAllByText("skipped")).toHaveLength(2);
  });

  it("offers nothing at all without onJump — a colleague's visit stays a readout", () => {
    render(<VisitStepper visit={visit()} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("On site")).toBeTruthy();
  });

  it("a live node says what tapping it does, not just that it has not happened", () => {
    render(<VisitStepper visit={visit()} onJump={vi.fn()} />);
    const onsite = screen.getByRole("button", { name: /On site/ });
    expect(onsite.textContent).toContain("tap to move the visit here");
  });
});
