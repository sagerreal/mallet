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

const sheet = (entries: MyHoursEntry[], over: { editingId?: string | null } = {}) =>
  render(
    <HoursSheet
      entries={entries}
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
    sheet([]);
    expect(screen.getByText("No shifts recorded this week.")).toBeTruthy();
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
