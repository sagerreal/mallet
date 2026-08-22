// @vitest-environment jsdom
/**
 * The week register. What is asserted here is the things a register gets WRONG when it is built
 * from stored rows instead of shifts:
 *
 *   - a day with a lunch is ONE row with break columns, not three rows the man has to reassemble;
 *   - a genuine gap (clocked out at noon, back at six) stays TWO rows, because merging them would
 *     invent a shift he never worked and pay him for the afternoon he was off;
 *   - a shift he cannot edit says WHY on the row — not behind the chevron, and never by silently
 *     omitting the control;
 *   - the merge never puts a correction out of reach: whatever the row cannot edit, the parts can.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HoursSheet } from "./hours-sheet";
import type { MyHoursEntry } from "./my-hours-derive";
import type { VisitStamp } from "./job-time-derive";

// @/lib/clock is mocked globally to 2026-07-01 — see vitest.setup.ts.
const TODAY = "2026-07-01";
const ME = "11111111-1111-1111-1111-111111111111";

// The row editor offers a job picker, which reads the tech's own jobs. Empty is a real state (a
// day with no jobs assigned) and it is the one this file cares least about.
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { field: { myJobs: { useQuery: () => ({ data: { items: [] } }) } } } },
}));

const entry = (over: Partial<MyHoursEntry> = {}): MyHoursEntry => ({
  id: "e1",
  techUserId: ME,
  jobId: null,
  workDate: TODAY,
  kind: "shop",
  startTime: "07:00",
  endTime: "16:00",
  minutes: null,
  note: "",
  src: "clock",
  status: "draft",
  running: false,
  approvedAt: null,
  createdAt: "2026-07-01T14:00:00.000Z",
  ...over,
});

const onSave = vi.fn();
const onDelete = vi.fn();
const onEdit = vi.fn();

const sheet = (
  entries: MyHoursEntry[],
  over: { editingId?: string | null; stamps?: VisitStamp[]; canEditOwnTimes?: boolean } = {},
) =>
  render(
    <HoursSheet
      entries={entries}
      stamps={over.stamps ?? []}
      canEditOwnTimes={over.canEditOwnTimes ?? true}
      today={TODAY}
      myUserId={ME}
      editingId={over.editingId ?? null}
      saving={false}
      saveError={null}
      suggestEndFor={() => null}
      onEdit={onEdit}
      onSave={onSave}
      onDelete={onDelete}
    />,
  );

/** The register's data rows, in order — the head is a row of headings, not a shift. */
const rows = (): HTMLElement[] => Array.from(document.querySelectorAll(".sh-entry"));
const cellsOf = (row: HTMLElement): string[] =>
  Array.from(row.querySelectorAll(".sh-row > *")).map((c) => c.textContent?.trim() ?? "");

beforeEach(() => vi.clearAllMocks());

describe("one row per shift", () => {
  it("folds a day with a lunch into ONE row, with the break in its own columns", () => {
    sheet([
      entry({ id: "am", startTime: "07:00", endTime: "12:00" }),
      entry({ id: "lunch", kind: "break", startTime: "12:00", endTime: "12:30" }),
      entry({ id: "pm", startTime: "12:30", endTime: "16:00" }),
    ]);

    expect(rows()).toHaveLength(1);
    const cells = cellsOf(rows()[0]!);
    expect(cells[1]).toBe("7a"); // start
    expect(cells[2]).toBe("12p"); // break start
    expect(cells[3]).toBe("12:30p"); // break end
    expect(cells[4]).toBe("4p"); // end
    // 8.5 hours on the clock less the half-hour lunch — the break is inside the shift, not beside it.
    expect(cells[5]).toContain("8.50");
  });

  it("keeps a real gap as TWO rows — merging them would invent a shift he never worked", () => {
    sheet([
      entry({ id: "morning", startTime: "07:00", endTime: "12:00" }),
      entry({ id: "evening", startTime: "18:00", endTime: "21:00" }),
    ]);

    expect(rows()).toHaveLength(2);
    expect(cellsOf(rows()[0]!)[5]).toContain("5.00");
    expect(cellsOf(rows()[1]!)[5]).toContain("3.00");
  });

  it("shows the first break and counts the rest, rather than growing a column per lunch", () => {
    sheet([
      entry({ id: "a", startTime: "07:00", endTime: "10:00" }),
      entry({ id: "b1", kind: "break", startTime: "10:00", endTime: "10:15" }),
      entry({ id: "b", startTime: "10:15", endTime: "13:00" }),
      entry({ id: "b2", kind: "break", startTime: "13:00", endTime: "13:30" }),
      entry({ id: "c", startTime: "13:30", endTime: "16:00" }),
    ]);

    expect(rows()).toHaveLength(1);
    const cells = cellsOf(rows()[0]!);
    expect(cells[2]).toBe("10a");
    expect(cells[3]).toContain("+1 more break");
  });

  it("says a shift is on the clock instead of showing an end it does not have", () => {
    sheet([entry({ id: "open", startTime: "07:00", endTime: null, running: true })]);
    expect(cellsOf(rows()[0]!)[4]).toBe("On the clock");
  });

  it("marks a running shift's total SO FAR, because the open stretch has no end to count", () => {
    // The trap: a session that has already banked two closed hours and is running again totals
    // 2.00. Printed as a flat "2.00 h" that reads as the shift's length, and a man who started at
    // seven and reads 2.00 at four o'clock stops trusting the screen.
    sheet([
      entry({ id: "banked", startTime: "07:00", endTime: "09:00" }),
      entry({ id: "still", startTime: "09:00", endTime: null, running: true }),
    ]);
    expect(rows()).toHaveLength(1);
    const total = rows()[0]!.querySelector(".sh-total")?.textContent ?? "";
    expect(total).toContain("2.00");
    expect(total).toContain("so far");
  });

  it("does not say 'so far' about a shift that has ended", () => {
    sheet([entry({ id: "done", startTime: "07:00", endTime: "16:00" })]);
    expect(rows()[0]!.querySelector(".sh-total")?.textContent).not.toContain("so far");
  });

  it("states the register is empty rather than rendering a bare head", () => {
    // "hours", not "shifts": the register holds days off too now, and a week with a holiday in it is
    // not a week with no hours.
    sheet([]);
    expect(screen.getByText("No hours recorded this week.")).toBeTruthy();
  });
});

describe("what a row will and will not let him touch", () => {
  it("offers the pencil on his own ordinary shift", () => {
    sheet([entry({ id: "mine" })]);
    fireEvent.click(screen.getByRole("button", { name: /^Edit the shift on/ }));
    expect(onEdit).toHaveBeenCalledWith("mine");
  });

  it("refuses a RUNNING shift and says the fix is to end the day", () => {
    sheet([entry({ id: "open", startTime: "07:00", endTime: null, running: true })]);
    expect(screen.queryByRole("button", { name: /^Edit the shift on/ })).toBeNull();
    // The reason is on the row, not behind the chevron: an absent control with no explanation is
    // how a man learns to stop reporting mistakes.
    expect(screen.getByText(/end the day and this becomes correctable/i)).toBeTruthy();
  });

  it("refuses an APPROVED shift, on the row, naming who to ask", () => {
    sheet([entry({ id: "signed", status: "approved", approvedAt: "2026-07-01T20:00:00.000Z" })]);
    expect(screen.queryByRole("button", { name: /^Edit the shift on/ })).toBeNull();
    expect(screen.getByText(/office/i)).toBeTruthy();
  });

  it("refuses the pencil on a MERGED shift but reaches every part through the chevron", () => {
    // The rule the office grid learned the hard way: a merged row the man cannot edit is a wrong
    // hour he cannot fix. The row declines to guess which part he meant; the parts stay editable.
    sheet([
      entry({ id: "am", startTime: "07:00", endTime: "12:00" }),
      entry({ id: "lunch", kind: "break", startTime: "12:00", endTime: "12:30" }),
      entry({ id: "pm", startTime: "12:30", endTime: "16:00" }),
    ]);

    expect(screen.queryByRole("button", { name: /^Edit the shift on/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Show what the/ }));
    // One per stored part, so no minute of the shift is out of reach.
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(3);
  });

  it("opens the editor under the row it belongs to, not at the foot of the register", () => {
    sheet([entry({ id: "mine" })], { editingId: "mine" });
    const detail = rows()[0]!.querySelector(".sh-detail");
    expect(detail, "the editor is not inside its own row").toBeTruthy();
    expect(detail?.textContent).toContain("Save");
  });
});

// ---------------------------------------------------------------------------
// WHAT THE SHIFT WAS SPENT ON. The expander's body is job attribution now — the jobs he tapped
// Arrived and Done on. It is NOT a breakdown of the shift and must never read as one.
// ---------------------------------------------------------------------------

/** A local wall clock on the mocked day, as an instant — assertions hold in any timezone. */
const at = (hhmm: string): string => new Date(`${TODAY}T${hhmm}:00`).toISOString();

const visitStamp = (over: Partial<VisitStamp> = {}): VisitStamp => ({
  visitId: "v1",
  jobId: "j1",
  jobNum: "JOB-1001",
  jobTitle: "Water heater swap",
  customerName: "Alvarez",
  workDate: TODAY,
  startedAt: at("09:00"),
  completedAt: at("11:30"),
  ...over,
});

const expand = () => fireEvent.click(screen.getByRole("button", { name: /^Show what the/ }));

describe("the shift's job attribution", () => {
  it("names the job, the customer and the taps", () => {
    sheet([entry({ id: "shift" })], { stamps: [visitStamp()] });
    expand();
    expect(screen.getByText("Water heater swap")).toBeTruthy();
    expect(screen.getByText(/Alvarez/)).toBeTruthy();
    expect(screen.getByText("9a")).toBeTruthy();
    expect(screen.getByText("11:30a")).toBeTruthy();
  });

  it("EXPLAINS the difference between the shift and its jobs instead of balancing it", () => {
    // A 9-hour shift with 2.5h on jobs. The honest answer to "where did the rest go" is a sentence
    // about driving and the shop — never an invented row that makes the columns agree.
    sheet([entry({ id: "shift", startTime: "07:00", endTime: "16:00" })], { stamps: [visitStamp()] });
    expand();
    expect(screen.getByText(/2\.50 h on jobs/)).toBeTruthy();
    expect(screen.getByText(/6\.50 h of this shift is not on a job/)).toBeTruthy();
  });

  it("says a visit was never stamped rather than showing it as zero hours", () => {
    sheet([entry({ id: "shift" })], {
      stamps: [visitStamp({ startedAt: null, completedAt: null })],
    });
    expand();
    expect(screen.getByText("not stamped")).toBeTruthy();
    // A MISSING TAP, which is what the office can fix — not "never stamped", which would be false of
    // a visit he did tap Done on.
    expect(screen.getByText(/1 visit missing a tap/)).toBeTruthy();
  });

  it("names the ARRIVAL as the missing tap when only Done was pressed", () => {
    sheet([entry({ id: "shift" })], { stamps: [visitStamp({ startedAt: null })] });
    expand();
    expect(screen.getByText("no arrival")).toBeTruthy();
    expect(screen.queryByText("not stamped")).toBeNull();
  });

  it("shows only the jobs from THIS shift's day", () => {
    sheet([entry({ id: "shift" })], {
      stamps: [visitStamp(), visitStamp({ visitId: "v2", jobTitle: "Other day", workDate: "2026-06-30" })],
    });
    expand();
    expect(screen.queryByText("Other day")).toBeNull();
  });

  it("states no job time plainly, and says where it would come from", () => {
    sheet([entry({ id: "shift" })], { stamps: [] });
    expand();
    expect(screen.getByText(/No job time recorded against this shift/)).toBeTruthy();
  });

  it("claims no gap while the shift is still running — its length is not final yet", () => {
    sheet([entry({ id: "open", startTime: "07:00", endTime: null, running: true })], {
      stamps: [visitStamp()],
    });
    expand();
    expect(screen.queryByText(/not on a job/)).toBeNull();
  });

  it("still reaches the parts of a MERGED shift, under the jobs", () => {
    // The register's own rule: a merged row the man cannot edit is a wrong hour he cannot fix.
    sheet(
      [
        entry({ id: "am", startTime: "07:00", endTime: "12:00" }),
        entry({ id: "lunch", kind: "break", startTime: "12:00", endTime: "12:30" }),
        entry({ id: "pm", startTime: "12:30", endTime: "16:00" }),
      ],
      { stamps: [visitStamp()] },
    );
    expand();
    expect(screen.getByText(/recorded in 3 pieces/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(3);
  });

  it("does NOT show a parts list for an ordinary one-entry shift — its own pencil edits it", () => {
    sheet([entry({ id: "shift" })], { stamps: [visitStamp()] });
    expand();
    expect(screen.queryByText(/recorded in/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DAYS OFF IN THE REGISTER. `offRows` was derived in PR 2 and then never drawn, so the summary
// counted eight hours the register could not explain — a man reading "48h regular" saw forty.
// ---------------------------------------------------------------------------

const offEntry = (over: Partial<MyHoursEntry> = {}): MyHoursEntry =>
  entry({ id: "off", kind: "holiday", startTime: null, endTime: null, minutes: 480, ...over });

describe("a day off in the register", () => {
  it("appears at all, with its kind and its length", () => {
    sheet([offEntry()]);
    expect(screen.getByText("Holiday")).toBeTruthy();
    expect(screen.getByText(/8\.00/)).toBeTruthy();
  });

  it("says it has no clock instead of filling the columns with dashes", () => {
    // Four em-dashes read as a shift somebody failed to record, not as a day nobody worked.
    sheet([offEntry()]);
    expect(screen.getByText("paid time off — no clock")).toBeTruthy();
  });

  it("sorts with the day it belongs to, ahead of that day's shifts", () => {
    sheet([
      entry({ id: "shift", workDate: "2026-07-02", startTime: "08:00", endTime: "16:00" }),
      offEntry({ workDate: "2026-07-02" }),
      entry({ id: "earlier", workDate: "2026-07-01", startTime: "08:00", endTime: "16:00" }),
    ]);
    const dates = rows().map((r) => r.querySelector(".sh-cell.day")?.textContent);
    // Wed 7/1 first; then Thursday's day off ahead of Thursday's shift — a day off is the whole day.
    expect(dates).toHaveLength(3);
    expect(rows()[1]?.textContent).toContain("Holiday");
  });

  it("can be removed when the shop allows it — two taps, never one", () => {
    sheet([offEntry()]);
    // WAS: a pencil that called onEdit and nothing answered — MyHoursTimeEditor renders only
    // inside SheetRow, so a day off's only control did nothing. Now it removes the row, armed.
    fireEvent.click(screen.getByRole("button", { name: /^Remove the time off on/ }));
    expect(onDelete, "one tap must not destroy a payroll row").not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Really remove the time off on/ }));
    expect(onDelete).toHaveBeenCalledWith("off");
  });
});

// ---------------------------------------------------------------------------
// THE ORG RULE. "Techs can edit their own times" defaults OFF, and the server has refused the write
// since #457 — the register drew the pencil anyway, so the only thing a tap could produce was an
// error message.
// ---------------------------------------------------------------------------

describe("a shop that keeps timesheet changes with the office", () => {
  it("draws no pencil on a shift", () => {
    sheet([entry({ id: "mine" })], { canEditOwnTimes: false });
    expect(screen.queryByRole("button", { name: /^Edit the shift on/ })).toBeNull();
  });

  it("draws no remove control on a day off either", () => {
    sheet([offEntry()], { canEditOwnTimes: false });
    expect(screen.queryByRole("button", { name: /^Remove the time off on/ })).toBeNull();
  });

  it("still lets him SEE what a shift was made of — looking is not editing", () => {
    sheet([entry({ id: "mine" })], { canEditOwnTimes: false });
    expect(screen.getByRole("button", { name: /^Show what the/ })).toBeTruthy();
  });

  it("does not blame the 7-day window for a lock the shop's own policy caused", () => {
    // "Older than 7 days — ask the office" would send him to fix the wrong thing: the row's age is
    // not why he cannot touch it.
    sheet([entry({ id: "old", workDate: "2026-06-01" })], { canEditOwnTimes: false });
    expect(screen.queryByText(/Older than 7 days/)).toBeNull();
  });
});
