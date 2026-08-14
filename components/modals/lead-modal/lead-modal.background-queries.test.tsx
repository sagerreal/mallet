// @vitest-environment jsdom
/**
 * The customer sheet is mounted on EVERY page — ModalHost renders it unconditionally and hands it
 * an `open` flag. It read its subject as `activeModal.params.leadId` without checking WHICH modal
 * was active, so any other sheet carrying a leadId — Call, Text, New quote — woke the whole
 * customer sheet's data layer behind it.
 *
 * On a technician's phone that is four ownerOrOffice reads (customers.get, quoting.listByLead,
 * customers.listNotes, tasks.list) firing 403s the moment he taps Call, on a surface he is not
 * even looking at.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

interface StoreShape {
  leads: Record<string, unknown>[];
  adoptLead: (lead: unknown) => void;
  updateLead: (id: string, patch: unknown) => void;
  adoptEstimateRecord: (e: unknown) => void;
  adoptLeadNotes: (id: string, notes: unknown) => void;
  estimates: unknown[];
  companies: unknown[];
  tasks: unknown[];
  jobs: unknown[];
  techs: unknown[];
}

const LEAD_ID = "11111111-1111-1111-1111-111111111111";

/** Which sheet is on top. The lead sheet is mounted either way; only one of these is IT. */
let activeModal: { id: string; params: Record<string, unknown> };
let store: StoreShape;

/** Every `enabled` this render asked for, by procedure — the whole point of the test. */
const enabled: Record<string, boolean | undefined> = {};

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: StoreShape) => unknown) => sel(store),
  useActiveModal: () => activeModal,
  useCloseModal: () => vi.fn(),
  usePushModal: () => vi.fn(),
  useOpenModal: () => vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => {
  const record = (key: string) => (_input: unknown, opts?: { enabled?: boolean }) => {
    enabled[key] = opts?.enabled;
    return { data: undefined, isLoading: false, isError: false, isFetched: true };
  };
  return {
    api: {
      v1: {
        links: { forRecord: { useQuery: () => ({ data: undefined }) } },
        customers: {
          get: { useQuery: record("customers.get") },
          listNotes: { useQuery: record("customers.listNotes") },
        },
        quoting: { listByLead: { useQuery: record("quoting.listByLead") } },
        tasks: { list: { useQuery: record("tasks.list") } },
      },
    },
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { LeadModal } from "./lead-modal";

const lead = () => ({
  id: LEAD_ID,
  name: "Dana Alvarez",
  phone: "+15105550199",
  stage: "Won",
  source: "Referral",
  addr: "12 Bay St",
});

describe("the customer sheet does not fetch behind another sheet", () => {
  beforeEach(() => {
    for (const k of Object.keys(enabled)) delete enabled[k];
    store = {
      leads: [lead()],
      adoptLead: vi.fn(),
      updateLead: vi.fn(),
      adoptEstimateRecord: vi.fn(),
      adoptLeadNotes: vi.fn(),
      estimates: [],
      companies: [],
      tasks: [],
      jobs: [],
      techs: [],
    };
  });

  it("asks for nothing while the Call sheet is the one on screen", () => {
    // The Call sheet carries the same leadId — that is what made the customer sheet think it was
    // being looked at.
    activeModal = { id: "CALL", params: { leadId: LEAD_ID } };
    render(<LeadModal open={false} />);
    expect(enabled["quoting.listByLead"]).toBe(false);
    expect(enabled["customers.listNotes"]).toBe(false);
    expect(enabled["tasks.list"]).toBe(false);
    expect(enabled["customers.get"]).toBe(false);
  });

  it("asks for nothing when no sheet is open at all", () => {
    activeModal = { id: "", params: {} };
    render(<LeadModal open={false} />);
    expect(enabled["quoting.listByLead"]).toBe(false);
    expect(enabled["customers.listNotes"]).toBe(false);
    expect(enabled["tasks.list"]).toBe(false);
  });

  it("still fetches the customer's work when the sheet itself is open", () => {
    activeModal = { id: "LEAD", params: { leadId: LEAD_ID } };
    render(<LeadModal open />);
    expect(enabled["quoting.listByLead"]).toBe(true);
    expect(enabled["customers.listNotes"]).toBe(true);
    expect(enabled["tasks.list"]).toBe(true);
  });
});
