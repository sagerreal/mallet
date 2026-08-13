// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MyHoursEntry } from "@/features/field/my-hours-derive";

// @/lib/clock is mocked globally to 2026-07-01, a Wednesday — see vitest.setup.ts.
const TODAY = "2026-07-01";
const ME = "11111111-1111-1111-1111-111111111111";
const SOMEONE_ELSE = "22222222-2222-2222-2222-222222222222";

const entry = (over: Partial<MyHoursEntry> = {}): MyHoursEntry => ({
  id: "e1",
  techUserId: ME,
  jobId: null,
  workDate: TODAY,
  kind: "shop",
  startTime: "07:42",
  endTime: "16:00",
  minutes: null,
  note: "",
  src: "clock",
  status: "draft",
  running: false,
  approvedAt: null,
  createdAt: "2026-07-01T14:42:00.000Z",
  ...over,
});

let listQuery: {
  data: { items: MyHoursEntry[]; nextCursor: string | null } | undefined;
  isFetched: boolean;
  isError: boolean;
  isRefetching: boolean;
  refetch: () => void;
};
let updateMutate: ReturnType<typeof vi.fn>;
let createMutate: ReturnType<typeof vi.fn>;
let removeMutate: ReturnType<typeof vi.fn>;
let updateError: { message: string } | null;
let meUserId: string | undefined;
let unreportedQuery: { data?: { items: unknown[] }; refetch: () => void };
let visitStampsQuery: { data?: { items: unknown[] } };
/** The shop's overtime rule, as the field surface reads it. Federal unless a test says otherwise. */
/**
 * Does the ORG let technicians correct their own hours? Defaults OFF in production (#457, the
 * Housecall Pro model), but most of this file exercises the correction paths, so it is ON here and
 * the off case has its own describe block at the foot.
 */
let techEditsTimes = true;
let overtimePolicy: { weeklyThresholdMinutes: number; dailyThresholdMinutes: number | null } = {
  weeklyThresholdMinutes: 2400,
  dailyThresholdMinutes: null,
};

vi.mock("@/features/identity/hooks", () => ({
  useMe: () => ({ data: meUserId === undefined ? undefined : { userId: meUserId } }),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { timesheets: { list: { invalidate: vi.fn() } } } }),
    v1: {
      // The field surface's only settings read — punch clock vs sheet. Defaults on.
      settings: {
        fieldToggles: {
          useQuery: () => ({
            data: { timesheetClock: true, overtime: overtimePolicy, techEditsTimes },
          }),
        },
      },
      field: {
        // The editor offers the caller's own jobs so a shop row can be re-filed as a job.
        myJobs: { useQuery: () => ({ data: { items: [{ id: "job-9", num: "JOB-9", title: "boiler" }] }, isLoading: false }) },
      },
      timesheets: {
        list: { useQuery: () => listQuery },
        // Days with visits stamped and no hours sent in. Its own query because the whole point is
        // days with NO rows — there is nothing in `list` to derive it from.
        unreportedDays: { useQuery: () => unreportedQuery },
        // What the week was SPENT ON — the visit taps, for the attribution panel under each shift.
        // A separate read from `list` on purpose: the clock and the job taps are different records
        // and do not have to agree.
        visitStamps: { useQuery: () => visitStampsQuery },
        update: {
          useMutation: () => ({ mutate: updateMutate, error: updateError, isPending: false }),
        },
        create: {
          useMutation: () => ({ mutate: createMutate, error: null, isPending: false }),
        },
        remove: {
          useMutation: () => ({ mutate: removeMutate, error: null, isPending: false }),
        },
      },
    },
  },
}));

import MyHoursPage from "./page";
import { dayLabel } from "@/features/field/my-hours-derive";

const withEntries = (items: MyHoursEntry[]): void => {
  listQuery = {
    data: { items, nextCursor: null },
    isFetched: true,
    isError: false,
    isRefetching: false,
    refetch: vi.fn(),
  };
};

beforeEach(() => {
  updateMutate = vi.fn();
  createMutate = vi.fn();
  removeMutate = vi.fn();
  updateError = null;
  unreportedQuery = { data: { items: [] }, refetch: vi.fn() };
  visitStampsQuery = { data: { items: [] } };
  techEditsTimes = true;
  meUserId = ME;
  withEntries([]);
});

describe("correcting a row", () => {
  it("saves the technician's own draft row with the times he picked, and stops it running", () => {
    withEntries([entry({ id: "draft-1", startTime: "08:00", endTime: "16:00" })]);
    render(<MyHoursPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Edit the shift on/ }));
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "17:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0]?.[0]).toEqual({
      entryId: "draft-1",
      // The row's existing type and job travel with the correction — editing the times must not
      // quietly re-file the work as something else.
      kind: "shop",
      jobId: null,
      startTime: "08:00",
      endTime: "17:30",
      running: false,
    });
  });

  it("refuses to save an end that is not after the start, and says why", () => {
    withEntries([entry({ id: "draft-1", startTime: "08:00", endTime: "16:00" })]);
    render(<MyHoursPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Edit the shift on/ }));
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "07:00" } });

    expect(screen.getByText("The end time has to be after the start time.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps the editor open and shows the server's refusal verbatim", () => {
    withEntries([entry({ id: "draft-1" })]);
    updateError = { message: "These hours are approved. Reopen the entry before changing it." };
    render(<MyHoursPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Edit the shift on/ }));

    expect(
      screen.getByText("These hours are approved. Reopen the entry before changing it."),
    ).toBeTruthy();
  });
});

describe("the editing window", () => {
  it("offers Edit on the oldest day in the window but not the day before it", () => {
    withEntries([
      entry({ id: "inside", workDate: "2026-06-25" }),
      entry({ id: "outside", workDate: "2026-06-24" }),
    ]);
    render(<MyHoursPage />);
    // Both days sit in the week before this one.
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));

    expect(screen.getAllByRole("button", { name: /^Edit the shift on/ })).toHaveLength(1);
    expect(screen.getByText("Older than 7 days — ask the office to change it.")).toBeTruthy();
  });
});

describe("a day left open", () => {
  const running = entry({ id: "open-1", startTime: "07:42", endTime: null, running: true });

  it("suggests the end of the last completed activity and closes the day in one tap", () => {
    withEntries([running, entry({ id: "done-1", startTime: "12:30", endTime: "16:12" })]);
    render(<MyHoursPage />);

    expect(screen.getByText("Your day is still open")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "End at 4:12p" }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0]?.[0]).toEqual({
      entryId: "open-1",
      endTime: "16:12",
      running: false,
    });
  });

  it("never invents an end when the day holds nothing later — it asks for one", () => {
    withEntries([running]);
    render(<MyHoursPage />);

    expect(screen.queryByRole("button", { name: /^End at / })).toBeNull();
    expect(
      screen.getByText("Nothing later that day to suggest an end from — set the time yourself."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "End my day" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows no banner when nothing of the technician's is running", () => {
    withEntries([
      entry(),
      entry({ id: "theirs", techUserId: SOMEONE_ELSE, endTime: null, running: true }),
    ]);
    render(<MyHoursPage />);

    expect(screen.queryByText("Your day is still open")).toBeNull();
  });
});

describe("approved hours", () => {
  it("cannot be edited from this surface, and the row says why and who to ask", () => {
    withEntries([
      entry({ id: "appr-1", status: "approved", approvedAt: "2026-06-30T12:00:00.000Z" }),
    ]);
    render(<MyHoursPage />);

    expect(screen.queryByRole("button", { name: /^Edit the shift on/ })).toBeNull();
    expect(screen.getByText(/ask the office to reopen$/)).toBeTruthy();
  });

  it("still lets the draft rows of a partly-approved day be corrected", () => {
    withEntries([
      entry({ id: "appr-1", status: "approved", approvedAt: "2026-06-30T12:00:00.000Z" }),
      entry({ id: "draft-1", startTime: "17:00", endTime: "18:00" }),
    ]);
    render(<MyHoursPage />);

    expect(screen.getAllByRole("button", { name: /^Edit the shift on/ })).toHaveLength(1);
    expect(screen.getByText(/ask the office to reopen$/)).toBeTruthy();
  });
});

describe("adding a block the clock missed", () => {
  it("creates it against the caller's own id, as a manual entry that is not running", () => {
    withEntries([entry()]);
    render(<MyHoursPage />);

    fireEvent.click(screen.getByRole("button", { name: "Add hours" }));
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "06:00" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "07:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Add these hours" }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0]?.[0]).toEqual({
      techUserId: ME,
      workDate: TODAY,
      kind: "shop",
      startTime: "06:00",
      endTime: "07:30",
      note: "",
      src: "manual",
      running: false,
    });
  });

  it("only offers the days inside the editing window", () => {
    withEntries([entry()]);
    render(<MyHoursPage />);

    fireEvent.click(screen.getByRole("button", { name: "Add hours" }));

    // Day is a SelectMenu now, so the choices live in a listbox that opens on click rather than
    // in <option> children. The window runs both ways since Aug 11: today first (the default),
    // then the week ahead, then the week behind.
    fireEvent.click(screen.getByLabelText("Day"));
    const days = screen.getAllByRole("option");
    expect(days).toHaveLength(14);
    expect(days[0]?.textContent).toContain(dayLabel(TODAY));
    expect(days[1]?.textContent).toContain(dayLabel("2026-07-02"));
    expect(days[7]?.textContent).toContain(dayLabel("2026-07-08"));
    expect(days[13]?.textContent).toContain(dayLabel("2026-06-25"));
  });
});

describe("the four list states", () => {
  it("shows the quiet loading state on a cold load, not an empty timesheet", () => {
    listQuery = { data: undefined, isFetched: false, isError: false, isRefetching: false, refetch: vi.fn() };
    render(<MyHoursPage />);

    expect(screen.getByText("Loading your hours…")).toBeTruthy();
    expect(screen.queryByText("No hours yet")).toBeNull();
  });

  it("shows the load-failed state — a failed fetch is not proof of no hours", () => {
    listQuery = { data: undefined, isFetched: true, isError: true, isRefetching: false, refetch: vi.fn() };
    render(<MyHoursPage />);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("No hours yet")).toBeNull();
  });

  it("shows the first-run state, and its action opens the add form", () => {
    render(<MyHoursPage />);

    expect(screen.getByText("No hours yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add hours" }));
    expect(screen.getByLabelText("Start")).toBeTruthy();
  });

  it("shows the week once there are rows", () => {
    withEntries([entry()]);
    render(<MyHoursPage />);

    expect(screen.queryByText("No hours yet")).toBeNull();
    expect(screen.getByRole("button", { name: /^Edit the shift on/ })).toBeTruthy();
  });

  // Everything the clock cannot attribute lands as "shop". Re-filing it as a job is the one
  // correction a timesheet exists for, and the field editor offered no way to do it — a day of
  // real work sat there labelled Shop with nothing the person who did it could change.
  it("re-files a shop row as work on a job", () => {
    withEntries([entry({ id: "draft-1", startTime: "13:01", endTime: "18:02" })]);
    render(<MyHoursPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Edit the shift on/ }));
    fireEvent.click(screen.getByRole("button", { name: "Job" }));
    fireEvent.change(screen.getByLabelText("Job"), { target: { value: "job-9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(updateMutate.mock.calls[0]?.[0]).toMatchObject({ kind: "job", jobId: "job-9" });
  });

  it("does not carry a job onto time that is not job time", () => {
    withEntries([entry({ id: "draft-1", startTime: "13:01", endTime: "18:02" })]);
    render(<MyHoursPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Edit the shift on/ }));
    fireEvent.click(screen.getByRole("button", { name: "Job" }));
    fireEvent.change(screen.getByLabelText("Job"), { target: { value: "job-9" } });
    // Changed their mind: a break is not work on a job.
    fireEvent.click(screen.getByRole("button", { name: "Break" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(updateMutate.mock.calls[0]?.[0]).toMatchObject({ kind: "break", jobId: null });
  });

  it("only offers a job picker once the row is being called job time", () => {
    withEntries([entry({ id: "draft-1", startTime: "13:01", endTime: "18:02" })]);
    render(<MyHoursPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Edit the shift on/ }));
    expect(screen.queryByLabelText("Job")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Job" }));
    expect(screen.getByLabelText("Job")).toBeTruthy();
  });
});

// Owen, Aug 11: "I need the ability to delete a timesheet entry." The server's remove endpoint
// existed all along (ownership-guarded, approved rows refused); the editor just never offered it.
describe("deleting a row", () => {
  it("arms on the first tap — deleting payroll hours is never one tap", () => {
    withEntries([entry({ id: "draft-1", startTime: "08:00", endTime: "16:00" })]);
    render(<MyHoursPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Edit the shift on/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(removeMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "⚠ Really delete? Tap again" })).toBeTruthy();
  });

  it("deletes on the second tap", () => {
    withEntries([entry({ id: "draft-1", startTime: "08:00", endTime: "16:00" })]);
    render(<MyHoursPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Edit the shift on/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "⚠ Really delete? Tap again" }));

    expect(removeMutate).toHaveBeenCalledTimes(1);
    expect(removeMutate.mock.calls[0]?.[0]).toEqual({ entryId: "draft-1" });
  });
});

// ---------------------------------------------------------------------------
// OVERTIME. This page had the federal weekly-40 threshold compiled in, so in a daily-overtime
// state it reported a technician's overtime as ZERO — ten hours he is owed, missing from the only
// screen that tells him what he earned. The figure now comes from the shop's own rule.
// ---------------------------------------------------------------------------

describe("My hours — the overtime figure obeys the shop's rule", () => {
  // Mon–Fri of the mocked week (2026-07-01 is a Wednesday, so this week starts Mon 2026-06-29).
  const tenHourWeek = (): MyHoursEntry[] =>
    ["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03"].map((workDate, i) =>
      entry({ id: `d${i}`, workDate, startTime: "07:00", endTime: "17:00" }),
    );

  beforeEach(() => {
    vi.clearAllMocks();
    meUserId = ME;
    updateError = null;
    unreportedQuery = { data: { items: [] }, refetch: vi.fn() };
    visitStampsQuery = { data: { items: [] } };
    techEditsTimes = true;
    listQuery = {
      data: { items: tenHourWeek(), nextCursor: null },
      isFetched: true,
      isError: false,
      isRefetching: false,
      refetch: vi.fn(),
    };
    overtimePolicy = { weeklyThresholdMinutes: 2400, dailyThresholdMinutes: null };
  });

  /** The summary's Overtime cell — read through its own label, not by hunting the page for text. */
  const overtimeCell = (): HTMLElement => {
    const label = screen.getByText("Overtime");
    const cell = label.parentElement;
    if (!cell) throw new Error("the Overtime label has no cell");
    return cell;
  };
  const regularCell = (): HTMLElement => {
    const label = screen.getByText("Regular hours");
    const cell = label.parentElement;
    if (!cell) throw new Error("the Regular hours label has no cell");
    return cell;
  };

  it("reports the weekly overage, and names the weekly rule, under a weekly-only policy", () => {
    // 50 worked, 10 past forty. Federal and California both land on ten here — by different
    // routes, which is exactly why the figure has to say which rule produced it.
    render(<MyHoursPage />);
    expect(overtimeCell().textContent).toContain("10h");
    expect(overtimeCell().textContent).toContain("past 40h this week");
  });

  it("reports the same ten hours as DAILY overtime in a daily-overtime state, never twice", () => {
    // California: 8h/day. The trap is counting the 10h daily overage AND the 10h past 40 — the
    // same hours, which would report 20.
    overtimePolicy = { weeklyThresholdMinutes: 2400, dailyThresholdMinutes: 480 };
    render(<MyHoursPage />);
    expect(overtimeCell().textContent).toContain("10h");
    expect(overtimeCell().textContent).not.toContain("20h");
    expect(overtimeCell().textContent).toContain("past 8h a day or 40h this week");
  });

  it("catches the overtime a weekly-only rule cannot see", () => {
    // Four ten-hour days: 40 worked, so a weekly-40 rule reports nothing — and in California the
    // man is owed 8 hours of overtime. This is the case the compiled-in threshold got wrong.
    listQuery.data = { items: tenHourWeek().slice(0, 4), nextCursor: null };
    overtimePolicy = { weeklyThresholdMinutes: 2400, dailyThresholdMinutes: 480 };
    render(<MyHoursPage />);
    expect(overtimeCell().textContent).toContain("8h");
  });

  it("reads zero rather than going blank when there is no overtime", () => {
    // The cell is always present: a missing figure and a zero figure are different claims, and on a
    // payroll screen the blank one reads as "we did not work it out".
    listQuery.data = { items: [entry({ startTime: "08:00", endTime: "16:00" })], nextCursor: null };
    render(<MyHoursPage />);
    expect(overtimeCell().textContent).toContain("0h");
  });

  it("counts paid time off toward paid hours but never toward overtime", () => {
    listQuery.data = {
      items: [
        ...tenHourWeek().slice(0, 4), // 40 worked
        entry({ id: "pto", workDate: "2026-07-03", kind: "pto", startTime: null, endTime: null, minutes: 480 }),
      ],
      nextCursor: null,
    };
    render(<MyHoursPage />);
    // 40 worked + 8 paid off = 48 REGULAR, uncapped: showing 40 would state a smaller number than
    // the shop is about to pay. And the holiday cannot push anyone into overtime.
    expect(regularCell().textContent).toContain("48h");
    expect(overtimeCell().textContent).toContain("0h");
  });

  it("measures the regular bar against the shop's OWN week, not a compiled-in forty", () => {
    // A 44-hour-week shop: 50 worked is 44 regular and 6 over. A hardcoded 40 would report 10.
    overtimePolicy = { weeklyThresholdMinutes: 2640, dailyThresholdMinutes: null };
    render(<MyHoursPage />);
    expect(regularCell().textContent).toContain("44h");
    expect(regularCell().textContent).toContain("of a 44h week");
    expect(overtimeCell().textContent).toContain("6h");
  });
});

// ---------------------------------------------------------------------------
// THE ORG RULE, on the whole page. "Techs can edit their own times" defaults OFF (#457). The server
// has always refused these writes; this page went on offering them, so every control here could
// only ever produce an error message.
// ---------------------------------------------------------------------------

describe("a shop that keeps timesheet changes with the office", () => {
  beforeEach(() => {
    techEditsTimes = false;
    withEntries([entry({ id: "mine", startTime: "08:00", endTime: "16:00" })]);
  });

  it("offers no way to add hours", () => {
    render(<MyHoursPage />);
    expect(screen.queryByRole("button", { name: "Add hours" })).toBeNull();
  });

  it("says WHO to ask instead of just removing the buttons", () => {
    // A control that vanishes without explanation reads as a broken app, on the screen where he is
    // already worried about his pay.
    render(<MyHoursPage />);
    expect(screen.getByText(/office/i)).toBeTruthy();
  });

  it("still shows him his hours — reading his own timesheet is never gated", () => {
    render(<MyHoursPage />);
    expect(screen.getByText(/8\.00/)).toBeTruthy();
  });

  it("turns the unreported-day card into a notice rather than two write buttons", () => {
    unreportedQuery = {
      data: {
        items: [
          {
            userId: ME,
            date: TODAY,
            visits: 2,
            firstStampAt: new Date(`${TODAY}T08:05:00`).toISOString(),
            lastStampAt: new Date(`${TODAY}T16:20:00`).toISOString(),
          },
        ],
      },
      refetch: vi.fn(),
    };
    render(<MyHoursPage />);

    expect(screen.queryByRole("button", { name: /^Add 8:05a/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enter my own hours" })).toBeNull();
    expect(screen.getByText("Ask the office to add this day.")).toBeTruthy();
  });

  it("shows the first-run screen without a dead action", () => {
    withEntries([]);
    render(<MyHoursPage />);
    expect(screen.getByText("No hours yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add hours" })).toBeNull();
  });
});
