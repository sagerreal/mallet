// @vitest-environment jsdom
/**
 * features/jobs/timesheets-entries.test.tsx
 *
 * The editor could set an entry's type, job and hours but never its DAY, so an entry could only
 * ever live on the day it was created — and "+ Add entry" anchors that to today. Typing up
 * Wednesday's hours on Friday, which is the whole reason manual entry exists, was impossible.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TsEntriesBlock } from "./timesheets-entries";
import type { TimeEntry } from "@/lib/store/types";

const WEEK = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25", "2026-07-26"];

const entry = (over: Partial<TimeEntry> = {}): TimeEntry =>
  ({
    id: "e1",
    techId: "t1",
    date: "2026-07-25",
    start: "08:00",
    end: "16:00",
    kind: "shop",
    jobId: null,
    note: "",
    src: "manual",
    running: false,
    status: "draft",
    ...over,
  }) as TimeEntry;

const onSetField = vi.fn();

const renderBlock = (e: TimeEntry) =>
  render(
    <TsEntriesBlock
      entries={[e]}
      techId="t1"
      jobs={[]}
      leads={[]}
      techs={[{ id: "t1", name: "Owen" } as never]}
      weekDates={WEEK}
      editId={e.id}
      pick={null}
      onSetPick={vi.fn()}
      onEdit={vi.fn()}
      onStop={vi.fn()}
      onDelete={vi.fn()}
      onSetField={onSetField}
      onCloseEdit={vi.fn()}
    />,
  );

describe("the entry editor's day picker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers every day of the week on screen", () => {
    renderBlock(entry());
    // One button per day, labelled so the date is unambiguous — not just a weekday name.
    for (const label of ["Mon 20", "Tue 21", "Wed 22", "Thu 23", "Fri 24", "Sat 25", "Sun 26"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("marks the day the entry is currently on", () => {
    renderBlock(entry({ date: "2026-07-22" }));
    expect(screen.getByRole("button", { name: "Wed 22" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Sat 25" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("moves the entry to the day that was picked", () => {
    renderBlock(entry({ date: "2026-07-25" }));
    fireEvent.click(screen.getByRole("button", { name: "Wed 22" }));
    expect(onSetField).toHaveBeenCalledWith("e1", "date", "2026-07-22");
  });

  it("does not offer a day outside the week on screen — the entry would vanish from view", () => {
    renderBlock(entry());
    expect(screen.queryByRole("button", { name: "Sun 19" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mon 27" })).toBeNull();
  });
});
