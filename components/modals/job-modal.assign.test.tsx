// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * Who a job is assigned to, read from the job — and changed from it.
 *
 * Assignment lives on the VISIT, and the picker sits inside the visit editor, under Schedule. So
 * opening a job could not answer the question a dispatcher asks most ("who has this?"), let alone
 * change it: the sheet showed "Schedule · 1 visit" and nothing about the crew.
 *
 * That answer used to be lifted out into an "Assigned to" row of its own. The row is gone — it set
 * the very same visit.techId the visit editor's Crew picker sets, so a job had two places to
 * reassign a visit and no rule about which won. The answer moved into the Schedule chapter's
 * COLLAPSED line instead: "1 visit · Rosa Boyd", visible with nothing opened. These tests pin the
 * same two things they always did — the crew is legible without a tap, and it is still changeable —
 * now through the one surface that owns it.
 */

const updateVisit = vi.fn();

interface Store {
  jobs: unknown[];
  leads: unknown[];
  techs: { id: string; name: string; skills?: string[] }[];
  invoices: unknown[];
  estimates: unknown[];
  checklists: unknown[];
  settings: Record<string, unknown>;
  roomsByJob: Record<string, unknown[]>;
  sitesByJob: Record<string, unknown[]>;
  toggles: Record<string, boolean>;
}
let store: Store;

const TECHS = [
  { id: "t1", name: "Rosa Boyd", skills: [] },
  { id: "t2", name: "Mike Rivera", skills: [] },
];

const job = (visits: unknown[]) => ({
  id: "job-1",
  num: "J-1",
  leadId: "lead-1",
  title: "Hydro-jetting — main sewer",
  status: "scheduled",
  visits,
  lines: [{ d: "Hydro-jetting", q: 1, r: 685 }],
  addons: [],
  archived: false,
  origin: "db",
});

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      ...store,
      updateVisit,
      addVisit: vi.fn(),
      removeVisit: vi.fn(),
      updateJob: vi.fn(),
      deleteJob: vi.fn(),
      adoptJob: vi.fn(),
      setJobLines: vi.fn(),
    }),
  useActiveModal: () => ({ id: "JOB", params: { jobId: "job-1" } }),
  useCloseModal: () => vi.fn(),
  usePushModal: () => vi.fn(),
  useOpenModal: () => vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { jobs: { list: { invalidate: vi.fn() } } } }),
    v1: {
      // The sheet header's record trail. Undefined data renders nothing, which is what these tests
      // want — they are about the sheet's own body, not the chain.
      links: { forRecord: { useQuery: () => ({ data: undefined }) } },
      jobs: { get: { useQuery: () => ({ data: undefined, isLoading: false, isError: false }) } },
      invoicing: { createFromJob: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) } },
      // The customer's note trail behind the Notes chapter — idle here.
      customers: { listNotes: { useQuery: () => ({ data: undefined }) } },
    },
  },
}));

import { JobModalContent } from "./job-modal";

/** The Schedule chapter's head — the row a dispatcher reads before touching anything. */
const scheduleHead = () => screen.getByRole("button", { name: /^Schedule/ });

describe("assigning a job", () => {
  beforeEach(() => {
    store = {
      jobs: [job([{ id: "v1", date: "2026-08-03", techId: "t1", start: 9, dur: 2, status: "scheduled" }])],
      leads: [{ id: "lead-1", name: "Sam Ortiz", phone: "+19255550099", archived: false }],
      techs: TECHS,
      invoices: [],
      estimates: [],
      checklists: [],
      settings: {},
      roomsByJob: {},
      sitesByJob: {},
      toggles: { measurementEstimating: false },
    };
    vi.clearAllMocks();
  });

  it("names the crew on the job, without opening anything", () => {
    render(<JobModalContent />);
    // Closed on arrival, and the crew's name is on the line anyway — that is the whole point:
    // "who's got this?" is answered by the sheet, not by a tap into the visit editor.
    expect(scheduleHead().getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("1 visit · Rosa Boyd")).toBeTruthy();
  });

  it("says Unassigned rather than leaving the row blank", () => {
    store.jobs = [job([{ id: "v1", date: "2026-08-03", techId: null, start: 9, dur: 2, status: "scheduled" }])];
    render(<JobModalContent />);
    expect(scheduleHead().getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("1 visit · Unassigned")).toBeTruthy();
  });

  // A job with two visits can genuinely have two technicians. Collapsing that into one picker
  // would silently move work nobody asked to move — so the closed line names both, in full.
  it("lists both crews when the visits differ", () => {
    store.jobs = [
      job([
        { id: "v1", date: "2026-08-03", techId: "t1", start: 9, dur: 2, status: "scheduled" },
        { id: "v2", date: "2026-08-05", techId: "t2", start: 13, dur: 2, status: "scheduled" },
      ]),
    ];
    render(<JobModalContent />);
    expect(screen.getByText("2 visits · Rosa Boyd, Mike Rivera")).toBeTruthy();
  });

  it("does not name a crew on a job with no visit — there is nothing to assign", () => {
    store.jobs = [job([])];
    render(<JobModalContent />);
    // "Add" — not "Unassigned", which would claim there is a visit sitting there with nobody on
    // it, and not a crew name carried over from anywhere.
    expect(scheduleHead().textContent).toContain("Add");
    expect(screen.queryByText(/Unassigned/)).toBeNull();
    expect(screen.queryByText(/Rosa Boyd|Mike Rivera/)).toBeNull();
  });

  // The "Assigned to" row was deleted, so this is the ONLY way to reassign from the job. If the
  // Crew picker inside Schedule ever stops writing the visit, the sheet has lost the ability
  // outright rather than merely moved it.
  it("still reassigns the visit, from the Crew picker inside Schedule", () => {
    render(<JobModalContent />);
    fireEvent.click(scheduleHead());

    const crew = screen.getByLabelText("Crew");
    expect(crew.textContent).toContain("Rosa Boyd");

    fireEvent.click(crew);
    fireEvent.mouseDown(screen.getByRole("option", { name: "Mike Rivera" }));

    expect(updateVisit).toHaveBeenCalledWith("job-1", "v1", { techId: "t2" });
  });

  /**
   * TAKING SOMEBODY OFF A VISIT, keeping the slot. An ordinary dispatch move — a tech calls in
   * sick and the office holds Tuesday 9am while it finds cover. The deleted "Assigned to" row fed
   * its picker an explicit empty option; the visit editor's picker was fed bare technician
   * options, so removing that row briefly made a crewed visit impossible to un-crew from here.
   */
  it("un-assigns a visit without giving up its day and time", () => {
    render(<JobModalContent />);
    fireEvent.click(scheduleHead());

    fireEvent.click(screen.getByLabelText("Crew"));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Unassigned" }));

    expect(updateVisit).toHaveBeenCalledWith("job-1", "v1", { techId: null });
  });

  /**
   * THE VISIT THAT HAS NO CREW IS THE ONE WAITING FOR A SLOT. VisitRow's crew picker lived only in
   * its PLACED branch, so an unplaced visit — the one most likely to have nobody on it — was the
   * one that could not be given anybody. It was hidden while "Assigned to" existed, because that
   * row listed every visit regardless of placement.
   */
  it("assigns a crew to a visit that has not been placed yet", () => {
    store.jobs = [job([{ id: "v1", date: null, techId: null, start: null, dur: 2, status: "pending" }])];
    render(<JobModalContent />);
    fireEvent.click(scheduleHead());

    expect(screen.getByText("Not placed")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Crew"));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Rosa Boyd" }));

    expect(updateVisit).toHaveBeenCalledWith("job-1", "v1", { techId: "t1" });
  });

  // Half-crewed is not crewed. "2 visits · Rosa Boyd" over one assigned and one bare visit reads
  // as a fully staffed job, and the bare half is the half somebody has to act on.
  it("names the unassigned half when only some visits have a crew", () => {
    store.jobs = [
      job([
        { id: "v1", date: "2026-08-03", techId: "t1", start: 9, dur: 2, status: "scheduled" },
        { id: "v2", date: "2026-08-05", techId: null, start: 13, dur: 2, status: "scheduled" },
      ]),
    ];
    render(<JobModalContent />);
    expect(screen.getByText("2 visits · Rosa Boyd, Unassigned")).toBeTruthy();
  });
});
