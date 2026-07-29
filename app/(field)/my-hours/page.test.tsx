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
let updateError: { message: string } | null;
let meUserId: string | undefined;

vi.mock("@/features/identity/hooks", () => ({
  useMe: () => ({ data: meUserId === undefined ? undefined : { userId: meUserId } }),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { timesheets: { list: { invalidate: vi.fn() } } } }),
    v1: {
      field: {
        // The editor offers the caller's own jobs so a shop row can be re-filed as a job.
        myJobs: { useQuery: () => ({ data: { items: [{ id: "job-9", num: "JOB-9", title: "boiler" }] }, isLoading: false }) },
      },
      timesheets: {
        list: { useQuery: () => listQuery },
        update: {
          useMutation: () => ({ mutate: updateMutate, error: updateError, isPending: false }),
        },
        create: {
          useMutation: () => ({ mutate: createMutate, error: null, isPending: false }),
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
  updateError = null;
  meUserId = ME;
  withEntries([]);
});

describe("correcting a row", () => {
  it("saves the technician's own draft row with the times he picked, and stops it running", () => {
    withEntries([entry({ id: "draft-1", startTime: "08:00", endTime: "16:00" })]);
    render(<MyHoursPage />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "07:00" } });

    expect(screen.getByText("The end time has to be after the start time.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps the editor open and shows the server's refusal verbatim", () => {
    withEntries([entry({ id: "draft-1" })]);
    updateError = { message: "These hours are approved. Reopen the entry before changing it." };
    render(<MyHoursPage />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

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

    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
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

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByText(/ask the office to reopen$/)).toBeTruthy();
  });

  it("still lets the draft rows of a partly-approved day be corrected", () => {
    withEntries([
      entry({ id: "appr-1", status: "approved", approvedAt: "2026-06-30T12:00:00.000Z" }),
      entry({ id: "draft-1", startTime: "17:00", endTime: "18:00" }),
    ]);
    render(<MyHoursPage />);

    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.getByText(/ask the office to reopen$/)).toBeTruthy();
  });
});

describe("adding a block the clock missed", () => {
  it("creates it against the caller's own id, as a manual entry that is not running", () => {
    withEntries([entry()]);
    render(<MyHoursPage />);

    fireEvent.click(screen.getByRole("button", { name: "Add hours you already worked" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Add hours you already worked" }));

    // Day is a SelectMenu now, so the choices live in a listbox that opens on click rather than
    // in <option> children. The assertion is unchanged in substance: seven days, today first,
    // the window's last day last.
    fireEvent.click(screen.getByLabelText("Day"));
    const days = screen.getAllByRole("option");
    expect(days).toHaveLength(7);
    expect(days[0]?.textContent).toContain(dayLabel(TODAY));
    expect(days[6]?.textContent).toContain(dayLabel("2026-06-25"));
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
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  // Everything the clock cannot attribute lands as "shop". Re-filing it as a job is the one
  // correction a timesheet exists for, and the field editor offered no way to do it — a day of
  // real work sat there labelled Shop with nothing the person who did it could change.
  it("re-files a shop row as work on a job", () => {
    withEntries([entry({ id: "draft-1", startTime: "13:01", endTime: "18:02" })]);
    render(<MyHoursPage />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Job" }));
    fireEvent.change(screen.getByLabelText("Job"), { target: { value: "job-9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(updateMutate.mock.calls[0]?.[0]).toMatchObject({ kind: "job", jobId: "job-9" });
  });

  it("does not carry a job onto time that is not job time", () => {
    withEntries([entry({ id: "draft-1", startTime: "13:01", endTime: "18:02" })]);
    render(<MyHoursPage />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByLabelText("Job")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Job" }));
    expect(screen.getByLabelText("Job")).toBeTruthy();
  });
});
