// @vitest-environment jsdom
/**
 * components/modals/job-modal.customer-notes.test.tsx
 *
 * "I had notes on the customer Cole, why aren't they here on the job?"
 *
 * Customer notes lived in two places — `lead.notes` and the lead_notes trail — and exactly one
 * surface rendered either of them: the customer sheet. The office job modal, the screen the
 * office actually has open when it dispatches, showed neither. This guards the row that fixes
 * that, and the three properties that make it safe to put a customer's record on a job screen:
 * it is absent when there is nothing to say, it is READ-ONLY (one record, one edit path), and it
 * reads the live lead rather than a copy taken when the job was created.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const adoptLeadNotes = vi.fn();

interface Store {
  jobs: unknown[];
  leads: unknown[];
  techs: unknown[];
  invoices: unknown[];
  estimates: unknown[];
  checklists: unknown[];
  settings: Record<string, unknown>;
  roomsByJob: Record<string, unknown[]>;
  sitesByJob: Record<string, unknown[]>;
  toggles: Record<string, boolean>;
}
let store: Store;

/** What the customers.listNotes query returns this render, plus the call it was made with. */
let notesQuery: { data: unknown } = { data: undefined };
let lastNotesCall: { input: unknown; opts: unknown } | undefined;

const JOB = {
  id: "job-1",
  num: "J-1",
  leadId: "lead-1",
  title: "Water heater swap",
  status: "scheduled",
  visits: [],
  lines: [],
  addons: [],
  archived: false,
  origin: "db",
};

const COLE = {
  id: "lead-1",
  name: "Cole Hayes",
  phone: "+19255550099",
  archived: false,
};

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      ...store,
      adoptLeadNotes,
      updateVisit: vi.fn(),
      addVisit: vi.fn(),
      removeVisit: vi.fn(),
      updateJob: vi.fn(),
      deleteJob: vi.fn(),
      adoptJob: vi.fn(),
      setJobLines: vi.fn(),
      addLeadNote: vi.fn(),
    }),
  useActiveModal: () => ({ id: "JOB", params: { jobId: "job-1" } }),
  useCloseModal: () => vi.fn(),
  usePushModal: () => vi.fn(),
  useOpenModal: () => vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { invoicing: { list: { invalidate: vi.fn() } } } }),
    v1: {
      jobs: { get: { useQuery: () => ({ data: undefined, isLoading: false, isError: false }) } },
      invoicing: { createFromJob: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
      customers: {
        listNotes: {
          useQuery: (input: unknown, opts: unknown) => {
            lastNotesCall = { input, opts };
            return notesQuery;
          },
        },
      },
    },
  },
}));

import { JobModalContent } from "./job-modal";

const custRow = () => screen.queryByText("Customer notes");

describe("the customer's notes on the job", () => {
  beforeEach(() => {
    store = {
      jobs: [JOB],
      leads: [COLE],
      techs: [],
      invoices: [],
      estimates: [],
      checklists: [],
      settings: {},
      roomsByJob: {},
      sitesByJob: {},
      toggles: { measurementEstimating: false },
    };
    notesQuery = { data: undefined };
    lastNotesCall = undefined;
    vi.clearAllMocks();
  });

  it("says nothing when the customer has no notes — an empty row is noise on a dispatch screen", () => {
    render(<JobModalContent />);
    expect(custRow()).toBeNull();
  });

  it("puts the LATEST note on the closed row, not a count — the gate code is the point", () => {
    store.leads = [
      {
        ...COLE,
        notes: "Dog in the yard",
        acts: [{ id: "n1", type: "note", when: "Tue", t: "Gate code 4482" }],
      },
    ];
    render(<JobModalContent />);
    expect(custRow()).toBeTruthy();
    expect(screen.getByText("Gate code 4482")).toBeTruthy();
    // A count would be useless here; assert the row is not one.
    expect(screen.queryByText("2")).toBeNull();
  });

  it("truncates a long note on the closed row rather than pushing the chevron off", () => {
    store.leads = [
      {
        ...COLE,
        acts: [
          {
            id: "n1",
            type: "note",
            when: "Tue",
            t: "Park on the street, the driveway cracks under a loaded van, and ring twice",
          },
        ],
      },
    ];
    render(<JobModalContent />);
    const val = screen.getByText(/^Park on the street/);
    expect(val.textContent!.length).toBeLessThanOrEqual(34);
    expect(val.textContent!.endsWith("…")).toBe(true);
  });

  it("opens the whole trail — the notes field AND the logged activity", () => {
    store.leads = [
      {
        ...COLE,
        job: "No hot water upstairs",
        notes: "Dog in the yard",
        acts: [
          { id: "n1", type: "call", dir: "in", when: "Mon", t: "Wants it done before Friday" },
          { id: "n2", type: "note", when: "Tue", t: "Gate code 4482" },
        ],
      },
    ];
    render(<JobModalContent />);
    fireEvent.click(screen.getByText("Customer notes"));

    expect(screen.getByText("No hot water upstairs")).toBeTruthy();
    expect(screen.getByText("Dog in the yard")).toBeTruthy();
    expect(screen.getByText("Wants it done before Friday")).toBeTruthy();
    // The snippet plus the trail row: the gate code now appears twice, which is correct.
    expect(screen.getAllByText("Gate code 4482").length).toBe(2);
  });

  it("is READ-ONLY — no composer, because the customer record is the one place to edit", () => {
    store.leads = [{ ...COLE, acts: [{ id: "n1", type: "note", when: "Tue", t: "Gate code 4482" }] }];
    render(<JobModalContent />);
    fireEvent.click(screen.getByText("Customer notes"));

    expect(screen.queryByLabelText("Add a note")).toBeNull();
    expect(screen.queryByText("Add note")).toBeNull();
    expect(screen.queryByPlaceholderText("gate code, what they want…")).toBeNull();
    // The way to edit is the customer link in the header, which stays.
    expect(screen.getByText("Cole Hayes →")).toBeTruthy();
  });

  it("reads the LIVE lead — a note added to the customer changes this row", () => {
    store.leads = [{ ...COLE, acts: [{ id: "n1", type: "note", when: "Mon", t: "Gate code 4482" }] }];
    const { rerender } = render(<JobModalContent />);
    expect(screen.getByText("Gate code 4482")).toBeTruthy();

    // The customer record gains a newer note (the store is the single source both sheets read).
    store.leads = [
      {
        ...COLE,
        acts: [
          { id: "n1", type: "note", when: "Mon", t: "Gate code 4482" },
          { id: "n2", type: "note", when: "Tue", t: "Code changed to 1170" },
        ],
      },
    ];
    rerender(<JobModalContent />);
    expect(screen.getByText("Code changed to 1170")).toBeTruthy();
    expect(screen.queryByText("Gate code 4482")).toBeNull();
  });

  it("keeps the job's OWN notes as a separate, differently named row", () => {
    store.jobs = [{ ...JOB, notes: "Bring the 40-gallon" }];
    store.leads = [{ ...COLE, acts: [{ id: "n1", type: "note", when: "Tue", t: "Gate code 4482" }] }];
    render(<JobModalContent />);
    // Two rows, two names — "Notes" twice would leave nobody able to tell them apart.
    expect(screen.getByText("Job notes")).toBeTruthy();
    expect(screen.getByText("Customer notes")).toBeTruthy();
    expect(screen.queryByText("Notes")).toBeNull();
  });
});

/**
 * The trail is FETCHED, not inherited.
 *
 * `lead.notes` is one field the hydrator rides along on the customer list; every note logged
 * since — calls, texts, the gate code typed into the customer sheet — lives in lead_notes and
 * only arrives via customers.listNotes. Same input and same options as the customer sheet, so
 * react-query serves one entry for both (identical key → identical query).
 */
describe("the live trail behind the row", () => {
  beforeEach(() => {
    store = {
      jobs: [JOB],
      leads: [COLE],
      techs: [],
      invoices: [],
      estimates: [],
      checklists: [],
      settings: {},
      roomsByJob: {},
      sitesByJob: {},
      toggles: { measurementEstimating: false },
    };
    notesQuery = { data: undefined };
    lastNotesCall = undefined;
    vi.clearAllMocks();
  });

  it("asks for THIS job's customer with the customer sheet's exact query key and options", () => {
    render(<JobModalContent />);
    expect(lastNotesCall?.input).toEqual({ leadId: "lead-1" });
    expect(lastNotesCall?.opts).toEqual({ enabled: true, refetchOnWindowFocus: false });
  });

  it("does not fetch for a job with no customer on it", () => {
    store.jobs = [{ ...JOB, leadId: null }];
    render(<JobModalContent />);
    expect((lastNotesCall?.opts as { enabled: boolean }).enabled).toBe(false);
    expect(custRow()).toBeNull();
  });

  it("adopts the server trail into the store, so the row and the customer sheet agree", () => {
    notesQuery = {
      data: {
        items: [
          {
            id: "n-srv",
            kind: "note",
            body: "Gate code 4482",
            createdAt: "2026-07-30T15:00:00.000Z",
            author: null,
            direction: null,
            outcome: null,
            durationLabel: null,
            via: null,
            overnight: false,
          },
        ],
      },
    };
    render(<JobModalContent />);
    expect(adoptLeadNotes).toHaveBeenCalledWith("lead-1", [
      expect.objectContaining({ id: "n-srv", type: "note", t: "Gate code 4482" }),
    ]);
  });
});
