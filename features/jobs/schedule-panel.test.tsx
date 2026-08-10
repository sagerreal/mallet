// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

interface Store {
  jobs: unknown[];
  leads: unknown[];
  techs: unknown[];
  placeVisit: () => void;
  addVisit: () => void;
  updateVisit: () => void;
  removeVisit: () => void;
  adoptJob: () => void;
  mergeJobs: () => void;
}
let storeState: Store;
let q: { isFetched: boolean; isError: boolean; data?: unknown } = { isFetched: true, isError: false };

// A needsSlot DTO as v1.jobs.list returns it — the tray reads the SERVER view, not the store.
const trayDTO = (over: Record<string, unknown> = {}) => ({
  id: "j1", leadId: "l1", num: "JOB-1", title: "Water heater", svc: "repair", kind: "work",
  status: "scheduled", sourceEstimateId: null, assigneeUserId: null, customerName: "Dana",
  addr: null, phone: null, notes: null, completion: null, invRequested: false, scope: null,
  callbackOf: null, callbackReason: null, checklist: null, requiredCerts: null,
  total: { cents: 0, currency: "USD" }, createdAt: "2026-08-01T00:00:00.000Z",
  lines: [], addons: [], verifyAnswers: [], photos: [],
  visits: [
    { id: "v1", assigneeUserId: null, scheduledDate: null, scheduledStart: null, scheduledEnd: null,
      durationMinutes: 120, status: "pending", enrouteAt: null, startedAt: null, completedAt: null,
      notes: null, position: 1 },
  ],
  ...over,
});
const openModal = vi.fn();
const routerReplace = vi.fn();
let placeParam: string | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: routerReplace }),
  useSearchParams: () => new URLSearchParams(placeParam ? { place: placeParam } : {}),
}));

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Store) => unknown) => sel(storeState),
  useOpenModal: () => openModal,
}));
vi.mock("@/lib/trpc/client", () => ({ api: { v1: { jobs: { list: { useQuery: () => q }, viewCounts: { useQuery: () => ({ data: undefined, isFetched: true }) } } } } }));

import { SchedulePanel } from "./schedule-panel";

const store = (jobs: unknown[], leads: Store["leads"] = []): Store => ({
  jobs, leads, techs: [],
  placeVisit: vi.fn(), addVisit: vi.fn(), updateVisit: vi.fn(), removeVisit: vi.fn(),
  adoptJob: vi.fn(), mergeJobs: vi.fn(),
});

describe("SchedulePanel — first-run empty state (board untouched)", () => {
  beforeEach(() => { storeState = store([]); q = { isFetched: true, isError: false }; vi.clearAllMocks(); });

  // Owen: "initially when this loads it shows up empty saying nothing to be scheduled and then it
  // populates." An empty list means "nothing fetched yet" for the first moment of every load, and
  // "Everything sold is scheduled." is a CLAIM — it was being made before the app had looked, then
  // contradicted a beat later when the cards arrived. A dispatcher who believes it walks away.
  it("does not claim everything is scheduled before the read lands", () => {
    storeState = store([{ id: "j1", visits: [{ id: "v1", date: "2026-08-01", techId: "t1" }] }]);
    q = { isFetched: false, isError: false };
    render(<SchedulePanel />);
    expect(screen.queryByText(/Everything sold is scheduled/)).toBeNull();
  });

  it("says it once the read lands and the tray is genuinely empty", () => {
    storeState = store([{ id: "j1", visits: [{ id: "v1", date: "2026-08-01", techId: "t1" }] }]);
    q = { isFetched: true, isError: false };
    render(<SchedulePanel />);
    expect(screen.getByText(/Everything sold is scheduled/)).toBeTruthy();
  });

  it("shows the first-run screen when loaded with nothing to schedule", () => {
    render(<SchedulePanel />);
    const frs = screen.getByText("Nothing to schedule yet").closest(".frs") as HTMLElement;
    fireEvent.click(within(frs).getByRole("button", { name: "+ New job" }));
    expect(openModal).toHaveBeenCalledWith("new-job");
  });

  it("does NOT show first-run when an estimate job exists (board has something to place)", () => {
    storeState = store([{ id: "j1", svc: "estimate", visits: [] }]);
    render(<SchedulePanel />);
    expect(screen.queryByText("Nothing to schedule yet")).toBeNull();
  });

  it("shows the quiet loading state on cold load — not the first-run flash", () => {
    q = { isFetched: false, isError: false };
    render(<SchedulePanel />);
    expect(screen.queryByText("Nothing to schedule yet")).toBeNull();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows the load-failed state — not the first-run screen — when the load errored", () => {
    q = { isFetched: true, isError: true };
    render(<SchedulePanel />);
    expect(screen.queryByText("Nothing to schedule yet")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

// Owen, testing: "how am I supposed to drag the boxes to the ones that are cut off". The board's
// crew rows run off the bottom and its hours off the right, and the ONE affordance that says you
// do not have to drag at all — tap the visit, then tap a crew and time — was hidden inside the
// multi-visit branch. The common card, a job with a single unplaced visit, had only a `title`
// tooltip, which never fires on a touch screen.
describe("SchedulePanel — the two-step is on the card you actually see", () => {
  beforeEach(() => { q = { isFetched: true, isError: false }; vi.clearAllMocks(); });

  // The store holds the job (adopted from the tray read); the TRAY itself comes from the
  // server's needsSlot view, so both have to be present for a tray card to render.
  const withTrayCard = () => {
    storeState = store([{ id: "j1", title: "Water heater", svc: "repair", visits: [{ id: "v1", dur: 2 }] }]);
    q = { isFetched: true, isError: false, data: { items: [trayDTO()] } };
  };

  it("names the tap-then-tap path on a single-unplaced-visit card", () => {
    withTrayCard();
    render(<SchedulePanel />);
    expect(screen.getByText(/Tap this card, then a crew & time/)).toBeTruthy();
  });

  /**
   * THE CARD ITSELF PICKS THE JOB UP. It used to open the job record, so the only way to arm was
   * the "Place on board" button — and arming is what compacts the tray. Until you found that
   * button the tray held 44vh and the board 62vh, which is more than one screen.
   */
  it("tapping the card arms the visit and gives the board its height back", () => {
    withTrayCard();
    const { container } = render(<SchedulePanel />);
    expect(container.querySelector(".tray-grid.compact")).toBeNull();

    fireEvent.click(screen.getByText("Water heater"));

    expect(container.querySelector(".tray-grid.compact")).toBeTruthy();
    expect(openModal).not.toHaveBeenCalled();
  });

  it("keeps the record one tap away, on the customer's name", () => {
    withTrayCard();
    // The name is what opens the record, so this case needs a customer to name.
    storeState = store(
      [{ id: "j1", leadId: "l1", title: "Water heater", svc: "repair", visits: [{ id: "v1", dur: 2 }] }],
      [{ id: "l1", name: "Dana Alvarez" }],
    );
    render(<SchedulePanel />);

    fireEvent.click(screen.getByRole("button", { name: "Dana Alvarez" }));

    expect(openModal).toHaveBeenCalledWith("job", { jobId: "j1" });
  });

  it("labels the button with what it does, not a bare verb", () => {
    withTrayCard();
    render(<SchedulePanel />);
    // "Schedule" alone reads as "do it now"; the button only ARMS the visit.
    expect(screen.getByRole("button", { name: "Place on board" })).toBeTruthy();
  });

  it("gives the board its height back while a visit is armed", () => {
    withTrayCard();
    const { container } = render(<SchedulePanel />);
    const tray = () => container.querySelector(".tray-grid") as HTMLElement;
    expect(tray().className).not.toMatch(/compact/);

    fireEvent.click(screen.getByRole("button", { name: "Place on board" }));
    expect(tray().className).toMatch(/compact/);
  });

  it("puts the 'tap a crew & time' strip next to the board, below the toolbar", () => {
    withTrayCard();
    const { container } = render(<SchedulePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Place on board" }));

    const strip = screen.getByText(/Tap a crew & time on the board to place/).closest("div") as HTMLElement;
    const toolbar = container.querySelector(".sched-toolbar") as HTMLElement;
    // Node.DOCUMENT_POSITION_FOLLOWING — the strip comes AFTER the toolbar in document order, so
    // it sits against the thing it is talking about instead of above the tray.
    expect(toolbar.compareDocumentPosition(strip) & 4).toBeTruthy();
  });
});


// A job created from the New-job form arrives with UNPLACED visits — there is no date picker in
// that form — so it navigates here with ?place=<id> to arm itself. The hazard the read-only arm
// exists for: addVisit is fire-and-forget in the create path, so a board mounting immediately
// after can see the job before its first visit lands. Minting one here would give the job two.
describe("SchedulePanel — ?place= arms the job that was just created", () => {
  beforeEach(() => {
    q = { isFetched: true, isError: false, data: { items: [trayDTO()] } };
    placeParam = null;
    vi.clearAllMocks();
  });

  it("arms the job's unplaced visit and drops the param", () => {
    placeParam = "j1";
    storeState = store([{ id: "j1", title: "Water heater", svc: "repair", visits: [{ id: "v1", dur: 2 }] }]);
    render(<SchedulePanel />);

    expect(screen.getByText(/Tap a crew & time on the board to place/)).toBeTruthy();
    expect(routerReplace).toHaveBeenCalledWith("/jobs?tab=schedule");
  });

  it("does NOT mint a visit when the store job has none yet — it waits", () => {
    placeParam = "j1";
    storeState = store([{ id: "j1", title: "Water heater", svc: "repair", visits: [] }]);
    render(<SchedulePanel />);

    expect(storeState.addVisit).not.toHaveBeenCalled();
    expect(screen.queryByText(/Tap a crew & time on the board to place/)).toBeNull();
    // Param NOT consumed — the next render, once the visit lands, arms it.
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("does nothing at all when the store has not caught up with the job", () => {
    placeParam = "j-not-here-yet";
    storeState = store([{ id: "j1", title: "Water heater", svc: "repair", visits: [{ id: "v1", dur: 2 }] }]);
    render(<SchedulePanel />);

    expect(storeState.addVisit).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("arms nothing without the param", () => {
    storeState = store([{ id: "j1", title: "Water heater", svc: "repair", visits: [{ id: "v1", dur: 2 }] }]);
    render(<SchedulePanel />);
    expect(screen.queryByText(/Tap a crew & time on the board to place/)).toBeNull();
  });
});
