// @vitest-environment jsdom
/**
 * THE JOB SHEET CARRIES THE NUMBER.
 *
 * It had Call and Text buttons but never showed the phone, so the one fact you need to do either
 * was invisible — and with no number on file there was no way to add one without leaving the job
 * for the customer record and coming back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const updateLead = vi.fn();
const pushModal = vi.fn();

interface Store {
  jobs: unknown[];
  leads: unknown[];
  invoices: unknown[];
  techs: unknown[];
  updateJob: () => void;
  updateLead: (id: string, patch: unknown) => void;
}
let store: Store;

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Store) => unknown) => sel(store),
  useActiveModal: () => ({ id: "JOB", params: { jobId: "job-1" } }),
  useCloseModal: () => vi.fn(),
  usePushModal: () => pushModal,
  useOpenModal: () => vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { invoicing: { list: { invalidate: vi.fn() } } } }),
    v1: {
      links: {
        forRecord: {
          useQuery: () => ({
            data: {
              customer: { id: "lead-1", name: "Cole Hayes" },
              quotes: [], jobs: [], invoices: [],
              counts: { quotes: 0, jobs: 0, invoices: 0 }, cap: 6,
            },
          }),
        },
      },
      jobs: { get: { useQuery: () => ({ data: undefined, isLoading: false, isError: false }) } },
      invoicing: { createFromJob: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
      customers: { listNotes: { useQuery: () => ({ data: undefined, isFetched: true }) } },
    },
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { JobModalContent } from "./job-modal";

const JOB = {
  id: "job-1",
  leadId: "lead-1",
  title: "Flat rate job test",
  cust: "Cole Hayes",
  addr: "493 San Ramon Valley Blvd",
  status: "scheduled",
  kind: "work",
  svc: "service",
  lines: [],
  visits: [],
  photos: [],
};

const seed = (leadPatch: Record<string, unknown> = {}) => {
  store = {
    jobs: [JOB],
    leads: [{ id: "lead-1", name: "Cole Hayes", stage: "Quoted", ...leadPatch }],
    invoices: [],
    techs: [],
    updateJob: vi.fn(),
    updateLead,
  };
};

const row = (label: RegExp) => screen.getByRole("button", { name: label });

describe("job sheet — contact rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
  });

  it("shows the customer's number without opening anything", () => {
    seed({ phone: "+14155550123" });
    render(<JobModalContent />);
    expect(row(/^Phone/).textContent).toMatch(/415/);
  });

  it("says Add when there is no number, so it is obvious one is missing", () => {
    seed({ phone: "" });
    render(<JobModalContent />);
    expect(row(/^Phone/).textContent).toMatch(/Add/);
  });

  it("carries the email too", () => {
    seed({ email: "cole@example.com" });
    render(<JobModalContent />);
    expect(row(/^Email/).textContent).toContain("cole@example.com");
  });

  // Call with no number used to stack a sheet whose whole job was one field — and it is titled
  // with the customer's name, so it reads as having started something else.
  it("Call with no number opens the Phone row rather than a second sheet", () => {
    seed({ phone: "" });
    render(<JobModalContent />);
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(pushModal).not.toHaveBeenCalled();
    expect(row(/^Phone/).getAttribute("aria-expanded")).toBe("true");
  });

  it("Text with no number does the same", () => {
    seed({ phone: "" });
    render(<JobModalContent />);
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    expect(pushModal).not.toHaveBeenCalled();
  });

  it("Call WITH a number still opens the call sheet", () => {
    seed({ phone: "+14155550123" });
    render(<JobModalContent />);
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(pushModal).toHaveBeenCalled();
  });
});
