// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mkEntry, mkJob, mkTech, mkVisit } from "./test-factories";
import { tsDayLabel } from "./timesheet-derive";
import type { Job, TimeEntry } from "@/lib/store/types";
import type { ApproveWeekOutcome } from "@/lib/store/slices/timesheets-slice";

// The whole panel, wired to the real crew card and entry rows — the running-entry repair path only
// exists if every one of those layers passes the tap through.

const TECH = mkTech({ id: "t1", name: "Mike Rivera" });
const TODAY = "2026-07-01"; // vitest.setup pins todayISO() here (a Wednesday)

interface Store {
  techs: unknown[];
  jobs: Job[];
  leads: unknown[];
  timeEntries: TimeEntry[];
  addTimeEntry: () => void;
  updateTimeEntry: (id: string, patch: Partial<TimeEntry>) => void;
  deleteTimeEntry: () => void;
  approveTechWeek: () => Promise<ApproveWeekOutcome>;
  reopenEntry: () => void;
  setTimeEntries: (entries: unknown[]) => void;
}

let storeState: Store;

vi.mock("@/lib/store/app-store", () => ({ useAppStore: (sel: (s: Store) => unknown) => sel(storeState) }));
vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      timesheets: {
        list: { useQuery: () => ({ isFetched: true, isError: false, data: { items: [] } }) },
        // A non-zero all-time count: the grid renders, rather than the first-run screen. The rows
        // under test come from the store, which is what the panel reads and what its edits write.
        count: { useQuery: () => ({ isFetched: true, isError: false, data: { total: 1 } }) },
        unreportedDays: { useQuery: () => ({ data: { items: [] } }) },
      },
    },
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { TimesheetsPanel } from "./timesheets-panel";

const running = (over: Partial<TimeEntry> = {}): TimeEntry =>
  mkEntry({ id: "e-live", techId: TECH.id, date: TODAY, kind: "shop", jobId: null, start: "08:00", end: null, running: true, src: "clock", ...over });

const store = (timeEntries: TimeEntry[], jobs: Job[] = []): Store => ({
  techs: [TECH],
  jobs,
  leads: [],
  timeEntries,
  addTimeEntry: vi.fn(),
  updateTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn(),
  approveTechWeek: vi.fn().mockResolvedValue({ status: "approved" } as ApproveWeekOutcome),
  reopenEntry: vi.fn(),
  setTimeEntries: vi.fn(),
});

describe("stopping a running entry from the office grid", () => {
  beforeEach(() => {
    storeState = store([running()]);
    vi.clearAllMocks();
  });

  it("opens the out-time picker on Stop instead of inventing an end time", () => {
    render(<TimesheetsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(screen.getByText(/Still on the clock/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "5:00pm" })).toBeTruthy();
    expect(storeState.updateTimeEntry).not.toHaveBeenCalled();
  });

  it("writes the chosen end time AND stops the clock in one change", () => {
    render(<TimesheetsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "5:00pm" }));

    // running must clear with the end time: an entry showing a complete span that still counts as
    // unfinished would block approval forever and be rejected by the QuickBooks push.
    expect(storeState.updateTimeEntry).toHaveBeenCalledWith("e-live", { end: "17:00", running: false });
  });

  it("lets the office edit a running entry's other fields — it is no longer inert", () => {
    render(<TimesheetsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Travel" }));

    expect(storeState.updateTimeEntry).toHaveBeenCalledWith("e-live", { kind: "travel" });
  });

  it("never offers an out time before the in time", () => {
    storeState = store([running({ start: "15:00" })]);
    render(<TimesheetsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(screen.queryByRole("button", { name: "9:00am" })).toBeNull();
    expect(screen.getByRole("button", { name: "3:15pm" })).toBeTruthy();
  });

  it("refuses to open an approved entry", () => {
    storeState = store([running({ id: "e-appr", status: "approved", end: "16:00", running: false })]);
    render(<TimesheetsPanel />);

    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });
});

describe("approving a week that is still on the clock", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names the refused days on the card instead of a generic failure", async () => {
    storeState = store([running({ date: "2026-06-30" })]);
    storeState.approveTechWeek = vi
      .fn()
      .mockResolvedValue({ status: "unfinished", days: ["2026-06-30"] } as ApproveWeekOutcome);
    render(<TimesheetsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(tsDayLabel("2026-06-30"));
  });

  it("says nothing when the week is approved", async () => {
    storeState = store([running({ end: "16:00", running: false })]);
    render(<TimesheetsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(storeState.approveTechWeek).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a scheduled day with nothing recorded", () => {
  it("is visible in the office grid", () => {
    const jobs = [mkJob({ id: "j1", visits: [mkVisit({ id: "v1", date: TODAY, techId: TECH.id })] })];
    // Monday's hours exist, Wednesday's job has none — the week is populated, so this is the
    // absence row and not the first-run screen.
    storeState = store([running({ id: "e-mon", date: "2026-06-29", end: "16:00", running: false })], jobs);
    render(<TimesheetsPanel />);

    expect(screen.getByText("No hours recorded")).toBeTruthy();
    expect(screen.getByText(tsDayLabel(TODAY, "long"))).toBeTruthy();
  });
});

// Owen: "I should be able to click and edit the entry — I have to click the pencil for it to work."
// A 14px icon is a far smaller target than the row it sits on (Fitts's Law), and the row is what a
// person reaches for. The pencil stays, so the affordance is still visible.
describe("the whole row opens the editor, not just the pencil", () => {
  const finished = (over: Partial<TimeEntry> = {}): TimeEntry =>
    mkEntry({
      id: "e-done",
      techId: TECH.id,
      date: TODAY,
      kind: "job",
      jobId: null,
      start: "08:00",
      end: "16:00",
      running: false,
      src: "clock",
      ...over,
    });

  const rowFor = (label: string) => {
    const btn = screen.getByRole("button", { name: new RegExp(label, "i") });
    // The row is the button's parent: the container holds the mouse handler (house .rowopen
    // pattern), because a clickable div wrapping buttons is a nested-interactive a11y violation.
    return btn.parentElement as HTMLElement;
  };

  beforeEach(() => {
    storeState = store([finished()]);
    vi.clearAllMocks();
  });

  it("opens the editor when the row itself is clicked", () => {
    render(<TimesheetsPanel />);
    fireEvent.click(rowFor("Edit Job entry"));
    // The editor's in/out picker triggers only exist once it is open (label carries a ▾ caret).
    expect(screen.getByRole("button", { name: /^8:00am/ })).toBeTruthy();
  });

  it("still opens from the label, for keyboard users", () => {
    render(<TimesheetsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Edit Job entry/i }));
    expect(screen.getByRole("button", { name: /^8:00am/ })).toBeTruthy();
  });

  it("does NOT also open the editor when Delete is clicked", () => {
    render(<TimesheetsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    // One tap must do one thing: the delete fired, the editor did not open behind it.
    expect(screen.queryByRole("button", { name: /^8:00am/ })).toBeNull();
    expect(storeState.deleteTimeEntry).toHaveBeenCalled();
  });

  it("leaves an APPROVED row unclickable — it is locked until the office reopens it", () => {
    storeState = store([finished({ status: "approved" })]);
    render(<TimesheetsPanel />);
    // No edit affordance at all on an approved row.
    expect(screen.queryByRole("button", { name: /Edit Job entry/i })).toBeNull();
  });
});
