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
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "17:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0]?.[0]).toEqual({
      entryId: "draft-1",
      startTime: "08:00",
      endTime: "17:30",
      running: false,
    });
  });

  it("refuses to save an end that is not after the start, and says why", () => {
    withEntries([entry({ id: "draft-1", startTime: "08:00", endTime: "16:00" })]);
    render(<MyHoursPage />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "07:00" } });

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
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "06:00" } });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "07:30" } });
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

    const days = screen.getByLabelText("Day") as HTMLSelectElement;
    expect(days.options).toHaveLength(7);
    expect(days.options[0]?.value).toBe(TODAY);
    expect(days.options[6]?.value).toBe("2026-06-25");
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
    expect(screen.getByLabelText("Start time")).toBeTruthy();
  });

  it("shows the week once there are rows", () => {
    withEntries([entry()]);
    render(<MyHoursPage />);

    expect(screen.queryByText("No hours yet")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });
});
