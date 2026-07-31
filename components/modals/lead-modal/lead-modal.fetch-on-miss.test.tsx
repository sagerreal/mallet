// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
  leads: { id: string; name: string; stage: string; phone: string }[];
  adoptLead: (lead: unknown) => void;
  updateLead: (id: string, patch: unknown) => void;
  estimates: unknown[];
  tasks: unknown[];
  jobs: unknown[];
  techs: unknown[];
}

let store: StoreShape;
let leadQuery: { data: unknown; isLoading: boolean; isError: boolean };
const adoptLead = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: StoreShape) => unknown) => sel(store),
  useActiveModal: () => ({ id: "LEAD", params: { leadId: "lead-off-page" } }),
  useCloseModal: () => vi.fn(),
  usePushModal: () => vi.fn(),
  useOpenModal: () => vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { customers: { get: { useQuery: () => leadQuery } } } },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { LeadModal } from "./lead-modal";

const NOT_AVAILABLE = /no longer available/i;

describe("opening a customer outside the loaded page", () => {
  beforeEach(() => {
    store = { leads: [], adoptLead, updateLead: vi.fn(), estimates: [], tasks: [], jobs: [], techs: [] };
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
