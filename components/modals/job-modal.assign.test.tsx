// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Changing who a job is assigned to, from the job.
 *
 * Assignment lives on the VISIT, and the picker was inside the visit editor — two accordions deep,
 * under Schedule. So opening a job could not answer the question a dispatcher asks most ("who has
 * this?"), let alone change it: the sheet showed "Schedule · 1 visit" and nothing about the crew.
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
      jobs: { get: { useQuery: () => ({ data: undefined, isLoading: false, isError: false }) } },
      invoicing: { createFromJob: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) } },
    },
  },
}));

import { JobModalContent } from "./job-modal";

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
      toggles: { measurementEstimating: false },
    };
    vi.clearAllMocks();
  });

  it("names the crew on the job, without opening anything", () => {
    render(<JobModalContent />);
    expect(screen.getByText("Assigned to")).toBeTruthy();
    expect(screen.getByText("Rosa Boyd")).toBeTruthy();
  });

  it("says Unassigned rather than leaving the row blank", () => {
    store.jobs = [job([{ id: "v1", date: "2026-08-03", techId: null, start: 9, dur: 2, status: "scheduled" }])];
    render(<JobModalContent />);
    expect(screen.getByText("Unassigned")).toBeTruthy();
  });

  // A job with two visits can genuinely have two technicians. Collapsing that into one picker
  // would silently move work nobody asked to move.
  it("lists both crews when the visits differ", () => {
    store.jobs = [
      job([
        { id: "v1", date: "2026-08-03", techId: "t1", start: 9, dur: 2, status: "scheduled" },
        { id: "v2", date: "2026-08-05", techId: "t2", start: 13, dur: 2, status: "scheduled" },
      ]),
    ];
    render(<JobModalContent />);
    expect(screen.getByText("Rosa Boyd, Mike Rivera")).toBeTruthy();
  });

  it("does not offer assignment on a job with no visit — there is nothing to assign", () => {
    store.jobs = [job([])];
    render(<JobModalContent />);
    expect(screen.queryByText("Assigned to")).toBeNull();
  });
});
