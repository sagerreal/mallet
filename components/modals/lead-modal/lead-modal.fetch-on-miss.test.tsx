// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * Opening a customer the store never hydrated.
 *
 * The Customers list is served by the database a page at a time, so it lists customers outside the
 * hydrator's page. This sheet resolved them from the store, found nothing, and said:
 *
 *     "This customer is no longer available — they may have been archived."
 *
 * That sentence is FALSE. The customer exists and is not archived — the browser simply had not
 * loaded them. A shop reads that as their data disappearing, which is the single worst thing a
 * record screen can claim, and it got more likely the bigger the customer book grew.
 */

interface StoreShape {
  leads: Record<string, unknown>[];
  adoptLead: (lead: unknown) => void;
  updateLead: (id: string, patch: unknown) => void;
  estimates: unknown[];
  companies: unknown[];
  tasks: unknown[];
  jobs: unknown[];
  techs: unknown[];
}

let store: StoreShape;
let leadQuery: { data: unknown; isLoading: boolean; isError: boolean };
const adoptLead = vi.fn();
const pushModal = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: StoreShape) => unknown) => sel(store),
  useActiveModal: () => ({ id: "LEAD", params: { leadId: "lead-off-page" } }),
  useCloseModal: () => vi.fn(),
  usePushModal: () => pushModal,
  useOpenModal: () => vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      // The sheet header's record trail — settled/empty for these tests.
      links: { forRecord: { useQuery: () => ({ data: undefined }) } },
      customers: {
        // The sheet's "Pipeline stage" row gates on this; empty = the row never renders.
        pipeline: { board: { useQuery: () => ({ data: undefined }) } },
        get: { useQuery: () => leadQuery },
        // The activity trail is fetched per customer; settled/empty for these routing tests.
        listNotes: { useQuery: () => ({ data: undefined, isFetched: true }) },
      },
      // per-customer work now fetched server-side; settled/empty for these routing tests
      quoting: { listByLead: { useQuery: () => ({ data: undefined, isFetched: true }) } },
      tasks: { list: { useQuery: () => ({ data: undefined, isFetched: true }) } },
    },
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { LeadModal } from "./lead-modal";

const NOT_AVAILABLE = /no longer available/i;

describe("opening a customer outside the loaded page", () => {
  beforeEach(() => {
    store = { leads: [], adoptLead, updateLead: vi.fn(), estimates: [], companies: [], tasks: [], jobs: [], techs: [] };
    leadQuery = { data: undefined, isLoading: true, isError: false };
    vi.clearAllMocks();
  });

  it("does not claim the customer was archived while the fetch is still in flight", () => {
    render(<LeadModal open />);
    expect(screen.queryByText(NOT_AVAILABLE)).toBeNull();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("adopts the fetched customer into the store", () => {
    leadQuery = {
      data: {
        id: "lead-off-page", name: "Zsofia Quennell", phone: "+15550001111", email: null,
        source: null, stage: "new", value: { cents: 0, currency: "USD" }, unread: false,
        notes: null, address: null, companyId: null, role: null,
        createdAt: new Date().toISOString(),
      },
      isLoading: false,
      isError: false,
    };
    render(<LeadModal open />);
    expect(adoptLead).toHaveBeenCalledWith(expect.objectContaining({ id: "lead-off-page", name: "Zsofia Quennell" }));
  });

  it("says the load failed, rather than blaming archiving, when the fetch errors", () => {
    leadQuery = { data: undefined, isLoading: false, isError: true };
    render(<LeadModal open />);
    expect(screen.queryByText(NOT_AVAILABLE)).toBeNull();
    expect(screen.getByText(/couldn.t load this customer/i)).toBeTruthy();
  });

  // The archived message is still correct for its ONE real cause: the id resolved to nothing and
  // no fetch is outstanding. Keeping it honest matters as much as removing it where it lied.
  it("still says archived when there is genuinely no such customer to fetch", () => {
    leadQuery = { data: undefined, isLoading: false, isError: false };
    render(<LeadModal open />);
    expect(screen.getByText(NOT_AVAILABLE)).toBeTruthy();
  });
});

describe("Lead sheet — the create-a-job action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Already in the book — this sheet is reached by tapping a row on the Customers list.
    store = {
      leads: [{
        id: "lead-off-page", name: "ZZ Bob Tester", phone: "7818328282", stage: "New customer",
        archived: false, value: 0, unread: false, age: 1, source: "", job: "", address: "",
      }],
      adoptLead, updateLead: vi.fn(), estimates: [], companies: [], tasks: [], jobs: [], techs: [],
    };
    leadQuery = { data: undefined, isLoading: false, isError: false };
  });

  it("offers Create a job, not Site visit", async () => {
    // The thin Site-visit form made a job with an unplaced visit — the New job modal's job, with
    // fewer fields. One way to make a job beats two that disagree about what a job needs.
    render(<LeadModal open />);

    expect(await screen.findByRole("button", { name: "Create a job" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Site visit" })).toBeNull();
  });

  it("opens the New job modal carrying the customer it was opened from", async () => {
    render(<LeadModal open />);

    fireEvent.click(await screen.findByRole("button", { name: "Create a job" }));

    expect(pushModal).toHaveBeenCalledWith("new-job", { leadId: "lead-off-page" });
  });
});

describe("Lead sheet — grouped rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = {
      leads: [{
        id: "lead-off-page", name: "ZZ Bob Tester", phone: "7818328282", stage: "New customer",
        archived: false, value: 0, unread: false, age: 1, source: "", job: "", address: "",
        email: "bob@example.com",
      }],
      adoptLead, updateLead: vi.fn(), estimates: [], companies: [], tasks: [], jobs: [], techs: [],
    };
    leadQuery = { data: undefined, isLoading: false, isError: false };
  });

  it("puts Email at the top level, beside Phone, instead of inside Details", async () => {
    // Email is a way to reach the customer, exactly like Phone — it had no business sitting one
    // tap deeper in a drawer that also holds the company and arbitrary custom fields.
    render(<LeadModal open />);

    expect(await screen.findByText("Email")).toBeTruthy();
    // The collapsed row shows its value, which is the whole point of this sheet's grammar.
    expect(screen.getByText("bob@example.com")).toBeTruthy();
  });

  it("groups the rows: Contact, Work, Details, Clean up", async () => {
    render(<LeadModal open />);

    expect(await screen.findByText("Contact")).toBeTruthy();
    expect(screen.getByText("Work")).toBeTruthy();
  });

  it("does not label the quotes section 'Work' too", async () => {
    // The quotes section used to be headed "Work", which would now collide with the Notes/Tasks
    // group — two different Works on one sheet.
    store.estimates = [];
    render(<LeadModal open />);
    await screen.findByText("Contact");

    expect(screen.queryAllByText("Work")).toHaveLength(1);
  });

  it("summarises Details by what is left in it, not by the email", async () => {
    // The Details row's collapsed value WAS the email. With email promoted, showing it there
    // would point at a field that no longer lives inside.
    render(<LeadModal open />);
    await screen.findByText("Details");

    const detailsRow = screen.getByText("Details").closest("div");
    expect(detailsRow?.textContent).not.toContain("bob@example.com");
  });
});
