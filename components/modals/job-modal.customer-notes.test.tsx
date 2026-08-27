// @vitest-environment jsdom
/**
 * components/modals/job-modal.customer-notes.test.tsx
 *
 * "I had notes on the customer Cole, why aren't they here on the job?"
 *
 * Customer notes lived in two places — `lead.notes` and the lead_notes trail — and exactly one
 * surface rendered either of them: the customer sheet. The office job modal, the screen the
 * office actually has open when it dispatches, showed neither. This guards the customer's trail
 * on the job sheet, and the three properties that make it safe to put a customer's record on a
 * job screen: it is absent when there is nothing to say, it is READ-ONLY (one record, one edit
 * path), and it reads the live lead rather than a copy taken when the job was created.
 *
 * The trail used to be a "Customer notes" row of its own. It is now the "On the customer" group
 * inside the single "Notes" chapter, beside the job's own "This job" group — same trail, same
 * three properties, reached through one chapter instead of two sibling rows. What the chapter's
 * CLOSED line says is part of the behaviour now: the job's own count leads, and the customer's
 * latest sentence stands in only when the job has nothing of its own.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

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
      // The sheet header's record trail. Real data here, because the READ-ONLY test below asserts
      // that the route to the customer record still exists — and the trail IS that route now.
      links: {
        forRecord: {
          useQuery: () => ({
            data: {
              customer: { id: "l1", name: "Cole Hayes" },
              quotes: [], jobs: [], invoices: [],
              counts: { quotes: 0, jobs: 0, invoices: 0 }, cap: 6,
            },
          }),
        },
      },
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

/** The Notes chapter head — the only line about notes the sheet shows before anything is opened. */
const notesHead = () => screen.getByRole("button", { name: /^Notes/ });

/**
 * What that head reads, minus its label and minus the caret glyph (which is aria-hidden, so a
 * screen reader does not say it either) — i.e. the summary a dispatcher takes in at a glance.
 */
const notesLine = () => notesHead().textContent!.replace("›", "").replace(/^Notes/, "").trim();

const openNotes = () => fireEvent.click(notesHead());

/** The customer's half of the open chapter. Named groups, so each note's owner is unambiguous. */
const custTrail = () => screen.queryByRole("group", { name: "On the customer" });
const jobHalf = () => screen.getByRole("group", { name: "This job" });

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

  it("says nothing when the customer has no notes — an empty group is noise on a dispatch screen", () => {
    render(<JobModalContent />);
    openNotes();
    // The job's own half always renders (it carries the composer and the files control); the
    // customer's half must not render a heading over nothing.
    expect(jobHalf()).toBeTruthy();
    expect(custTrail()).toBeNull();
    expect(notesLine()).toBe("Add");
  });

  it("puts the LATEST note on the closed line, not a count — the gate code is the point", () => {
    store.leads = [
      {
        ...COLE,
        notes: "Dog in the yard",
        acts: [{ id: "n1", type: "note", when: "Tue", t: "Gate code 4482" }],
      },
    ];
    render(<JobModalContent />);
    // A count would be useless here — "2" says nothing to a plumber standing at a gate. Asserting
    // the whole line, not just that the sentence is somewhere in it, is what rules a count out.
    expect(notesLine()).toBe("Gate code 4482");
    // And it is on the CLOSED line: the trail itself is still behind the chapter.
    expect(custTrail()).toBeNull();
  });

  it("truncates a long note on the closed line rather than pushing the caret off", () => {
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
    const line = notesLine();
    expect(line.startsWith("Park on the street")).toBe(true);
    expect(line.length).toBeLessThanOrEqual(34);
    expect(line.endsWith("…")).toBe(true);
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
    openNotes();

    const trail = within(custTrail()!);
    expect(trail.getByText("No hot water upstairs")).toBeTruthy();
    expect(trail.getByText("Dog in the yard")).toBeTruthy();
    expect(trail.getByText("Wants it done before Friday")).toBeTruthy();
    expect(trail.getByText("Gate code 4482")).toBeTruthy();
    // The closed line's snippet plus the trail row: the gate code appears twice, which is correct.
    expect(screen.getAllByText("Gate code 4482").length).toBe(2);
  });

  it("is READ-ONLY — no composer on the customer's half, because the customer record is the one place to edit", () => {
    store.leads = [{ ...COLE, acts: [{ id: "n1", type: "note", when: "Tue", t: "Gate code 4482" }] }];
    render(<JobModalContent />);
    openNotes();

    const trail = within(custTrail()!);
    expect(trail.queryByRole("textbox")).toBeNull();
    expect(trail.queryByLabelText("Add a note")).toBeNull();
    expect(trail.queryByText("Add note")).toBeNull();
    // The composer that DOES sit in this chapter writes to the job, not to the customer — the two
    // halves share a chapter, never an edit path.
    expect(within(jobHalf()).getByLabelText("Add a note")).toBeTruthy();
    // The way to edit is the header's trail, which is now the route to the customer record. It used
    // to be a hand-rolled "Cole Hayes →" link that only rendered when the STORE held the lead.
    const hop = screen.getByRole("button", { name: "Cole Hayes" });
    expect(hop.className).toContain("hop");
  });

  it("reads the LIVE lead — a note added to the customer changes this line", () => {
    store.leads = [{ ...COLE, acts: [{ id: "n1", type: "note", when: "Mon", t: "Gate code 4482" }] }];
    const { rerender } = render(<JobModalContent />);
    expect(notesLine()).toBe("Gate code 4482");

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
    expect(notesLine()).toBe("Code changed to 1170");
    expect(screen.queryByText("Gate code 4482")).toBeNull();
  });

  it("keeps the job's OWN notes and the customer's apart — two named groups, not one merged feed", () => {
    store.jobs = [{ ...JOB, notes: "Bring the 40-gallon" }];
    store.leads = [{ ...COLE, acts: [{ id: "n1", type: "note", when: "Tue", t: "Gate code 4482" }] }];
    render(<JobModalContent />);
    openNotes();

    // One chapter now, but each note still has to say whose record it is on — a merged feed would
    // leave nobody able to tell "Bring the 40-gallon" (this job) from the customer's standing note.
    const job = within(jobHalf());
    const trail = within(custTrail()!);
    expect(job.getByText("Bring the 40-gallon")).toBeTruthy();
    expect(job.queryByText("Gate code 4482")).toBeNull();
    expect(trail.getByText("Gate code 4482")).toBeTruthy();
    expect(trail.queryByText("Bring the 40-gallon")).toBeNull();
  });

  it("lets the job's own count lead the closed line — the customer's sentence only stands in when the job has none", () => {
    store.jobs = [{ ...JOB, notes: "Bring the 40-gallon" }];
    store.leads = [{ ...COLE, acts: [{ id: "n1", type: "note", when: "Tue", t: "Gate code 4482" }] }];
    render(<JobModalContent />);
    // This sheet is about the job, so its own record wins the one line there is; the customer's
    // sentence is a stand-in for an empty line, never a thing that displaces the job's count.
    expect(notesLine()).toBe("1");
    expect(screen.queryByText("Gate code 4482")).toBeNull();
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
describe("the live trail behind the chapter", () => {
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
    openNotes();
    expect(custTrail()).toBeNull();
  });

  it("adopts the server trail into the store, so the chapter and the customer sheet agree", () => {
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
