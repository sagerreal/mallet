// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRef } from "react";

/**
 * CLICKING A CUSTOMER TOOK THE WHOLE MODAL DOWN.
 *
 *   Minified React error #310 — "Rendered more hooks than during the previous render"
 *   → "Something went wrong."  Every customer, every time, in production.
 *
 * `api.v1.customers.pipeline.board.useQuery` was called BELOW the `if (!lead) return`. The sheet
 * always renders at least twice: once while the customer is still being fetched (lead undefined,
 * early return taken, that hook never reached) and again once it arrives (early return skipped,
 * the hook now runs). Different hook counts across renders is precisely what React forbids.
 *
 * This test reproduces that sequence — render with no lead, then rerender with one — which is the
 * only way to catch it. A test that renders once with a lead present passes happily, which is why
 * the existing suites did.
 */

interface StoreShape {
  leads: Record<string, unknown>[];
  adoptLead: (lead: unknown) => void;
  adoptEstimateRecord: (e: unknown) => void;
  adoptLeadNotes: (id: string, n: unknown) => void;
  updateLead: (id: string, patch: unknown) => void;
  addLeadNote: (id: string, n: unknown) => void;
  estimates: unknown[];
  companies: unknown[];
  tasks: unknown[];
  jobs: unknown[];
  techs: unknown[];
}

const LEAD = {
  id: "lead-1",
  name: "Dana Whitfield",
  phone: "+14155550123",
  stage: "New customer",
  address: "12 Alder St",
};

let store: StoreShape;

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: StoreShape) => unknown) => sel(store),
  useActiveModal: () => ({ id: "LEAD", params: { leadId: "lead-1" } }),
  useCloseModal: () => vi.fn(),
  usePushModal: () => vi.fn(),
  useOpenModal: () => vi.fn(),
}));

/**
 * THE MOCK HAS TO CONSUME A REAL HOOK. A stub like `useQuery: () => ({ data })` is a plain
 * function, so mocking it away DELETES the hook — and a hook-order bug becomes invisible to the
 * very test written to catch it. (That is not hypothetical: the first version of this file passed
 * with the bug deliberately reintroduced.) React's useQuery calls useState/useEffect internally,
 * so the fake calls useRef to occupy exactly one hook slot and reproduce the real arithmetic.
 */
vi.mock("@/lib/trpc/client", () => {
  // Defined INSIDE the factory: vi.mock is hoisted above every top-level binding.
  const fakeQuery = (data: unknown) => () => {
    useRef(null);
    return { data, isLoading: false, isError: false, isFetched: true };
  };
  return {
  api: {
    v1: {
      links: { forRecord: { useQuery: fakeQuery(undefined) } },
      customers: {
        // A shop WITH pipeline stages — the branch that actually reads the query.
        pipeline: { board: { useQuery: fakeQuery({ stages: [{ id: "s1", name: "Quoted" }] }) } },
        get: { useQuery: fakeQuery(undefined) },
        listNotes: { useQuery: fakeQuery(undefined) },
      },
      quoting: { listByLead: { useQuery: fakeQuery(undefined) } },
      tasks: { list: { useQuery: fakeQuery(undefined) } },
    },
  },
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { LeadModal } from "./lead-modal";

const emptyStore = (): StoreShape => ({
  leads: [],
  adoptLead: vi.fn(),
  adoptEstimateRecord: vi.fn(),
  adoptLeadNotes: vi.fn(),
  updateLead: vi.fn(),
  addLeadNote: vi.fn(),
  estimates: [],
  companies: [],
  tasks: [],
  jobs: [],
  techs: [],
});

describe("Lead sheet — hook order across the not-loaded → loaded transition", () => {
  beforeEach(() => {
    store = emptyStore();
  });

  it("survives the customer arriving after the first render", () => {
    // React does NOT throw #310 out of rerender() — it logs and recovers — so asserting
    // not.toThrow() proves nothing. Watch console.error for the real signal.
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      errors.push(a.map(String).join(" "));
    });

    // Render 1: the store has no lead yet, so the sheet takes its early return.
    const { rerender } = render(<LeadModal open />);
    expect(screen.getAllByText(/Customer/i).length).toBeGreaterThan(0);

    // Render 2: the lead lands. Every hook must have been called on render 1 too.
    store = { ...emptyStore(), leads: [LEAD] };
    rerender(<LeadModal open />);

    const hookError = errors.find((e) => /more hooks than during the previous render|#310/i.test(e));
    spy.mockRestore();
    expect(hookError, `React reported a hook-order violation: ${hookError ?? ""}`).toBeUndefined();
    expect(screen.getByText("Dana Whitfield")).toBeTruthy();
  });

  it("survives the customer going away again", () => {
    store = { ...emptyStore(), leads: [LEAD] };
    const { rerender } = render(<LeadModal open />);
    store = emptyStore();
    expect(() => rerender(<LeadModal open />)).not.toThrow();
  });
});
