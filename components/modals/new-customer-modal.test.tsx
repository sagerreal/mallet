// @vitest-environment jsdom
/**
 * components/modals/new-customer-modal.test.tsx
 * The submit button must actually create the booked work it names:
 *   "Create job"            → addJob + one unplaced visit (after persist reconcile)
 *   "Create estimate visit" → a store evisit on the created lead
 *   dedup hit               → NO work created (the phone belongs to someone else)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewCustomerModal } from "./new-customer-modal";

// ---- store mock ---------------------------------------------------------------

const addJob = vi.fn();
const addVisit = vi.fn();
const addCompany = vi.fn();
const addSource = vi.fn();
const updateLead = vi.fn();
const setLeads = vi.fn();

// Mutable store state — tests may push leads in to exercise the "already in
// store" evisit path. Reset in beforeEach.
const storeState = {
  addJob,
  addVisit,
  addCompany,
  addSource,
  updateLead,
  setLeads,
  companies: [] as unknown[],
  sources: [] as unknown[],
  leads: [] as { id: string; evisits?: unknown[] }[],
};

let closeMock = vi.fn();
let openModalMock = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useCloseModal: () => closeMock,
  useOpenModal: () => openModalMock,
  useActiveModal: () => null,
  useAppStore: Object.assign(
    (selector: (s: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState },
  ),
}));

// ---- trpc mock ------------------------------------------------------------------

const invalidate = vi.fn();
const mutateMock = vi.fn();

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { customers: { list: { invalidate } } } }),
    v1: { customers: { create: { useMutation: () => ({ mutate: mutateMock, isPending: false }) } } },
  },
}));

// ---- helpers --------------------------------------------------------------------

/** Full create-mutation DTO (leadDTO + created flag) — toStoreLead consumes it. */
function createdDto(overrides: Record<string, unknown> = {}) {
  return {
    id: "srv-lead-1",
    name: "Gary Waters",
    phone: "9255550100",
    email: null,
    source: null,
    stage: "new_lead",
    value: { cents: 0, currency: "USD" },
    unread: false,
    companyId: null,
    role: null,
    notes: null,
    address: null,
    createdAt: new Date().toISOString(),
    created: true,
    ...overrides,
  };
}

/** mutate(input, { onSuccess }) → resolve immediately with the given DTO. */
function resolveCreateWith(dto: ReturnType<typeof createdDto>) {
  mutateMock.mockImplementation(
    (_input: unknown, opts: { onSuccess: (d: unknown) => void }) => opts.onSuccess(dto),
  );
}

function fillNameAndOpenBooking(name: string) {
  fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: name } });
  fireEvent.click(screen.getByText("Book a visit"));
}

beforeEach(() => {
  vi.clearAllMocks();
  closeMock = vi.fn();
  openModalMock = vi.fn();
  storeState.leads = [];
});

// ---- tests ----------------------------------------------------------------------

describe("NewCustomerModal — submit with the Job purpose", () => {
  it("creates the job on the SERVER lead id and adds the visit after persist resolves", async () => {
    resolveCreateWith(createdDto());
    let resolvePersist: () => void = () => {};
    addJob.mockReturnValue({
      job: { id: "job-1" },
      persisted: new Promise<void>((res) => { resolvePersist = res; }),
    });

    render(<NewCustomerModal open />);
    fillNameAndOpenBooking("Gary Waters");
    fireEvent.change(screen.getByPlaceholderText("water heater making noise"), {
      target: { value: "leaky spigot" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Job" }));
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));

    await waitFor(() => expect(addJob).toHaveBeenCalledOnce());
    expect(addJob).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "srv-lead-1", title: "leaky spigot", svc: "service" }),
    );
    // The default unplaced visit only attaches AFTER the job persist reconciles.
    expect(addVisit).not.toHaveBeenCalled();
    resolvePersist();
    await waitFor(() => expect(addVisit).toHaveBeenCalledWith("job-1"));
    expect(invalidate).toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
  });
});

describe("NewCustomerModal — submit with the Estimate-visit purpose", () => {
  it("inserts the created lead into the store with one 0.5h evisit", async () => {
    resolveCreateWith(createdDto());

    render(<NewCustomerModal open />);
    fillNameAndOpenBooking("Gary Waters");
    fireEvent.change(screen.getByPlaceholderText("water heater making noise"), {
      target: { value: "quote a repipe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Estimate visit" }));
    fireEvent.click(screen.getByRole("button", { name: "Create estimate visit" }));

    await waitFor(() => expect(setLeads).toHaveBeenCalledOnce());
    const [leads] = setLeads.mock.calls[0] as [
      { id: string; job: string; evisits: { dur: number; status: string; date: null }[] }[],
    ];
    expect(leads[0]).toMatchObject({ id: "srv-lead-1", job: "quote a repipe" });
    expect(leads[0]!.evisits).toHaveLength(1);
    expect(leads[0]!.evisits[0]).toMatchObject({ dur: 0.5, status: "scheduled", date: null });
    // No job created on the estimate path.
    expect(addJob).not.toHaveBeenCalled();
    // The evisit is store-local — an invalidate-triggered rehydrate would wipe it.
    expect(invalidate).not.toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
  });

  it("patches evisits onto the lead when the store already has it", async () => {
    resolveCreateWith(createdDto());
    storeState.leads = [{ id: "srv-lead-1", evisits: [] }];

    render(<NewCustomerModal open />);
    fillNameAndOpenBooking("Gary Waters");
    fireEvent.click(screen.getByRole("button", { name: "Estimate visit" }));
    fireEvent.click(screen.getByRole("button", { name: "Create estimate visit" }));

    await waitFor(() => expect(updateLead).toHaveBeenCalledOnce());
    const [id, patch] = updateLead.mock.calls[0] as [string, { evisits: { dur: number }[] }];
    expect(id).toBe("srv-lead-1");
    expect(patch.evisits).toHaveLength(1);
    expect(patch.evisits[0]).toMatchObject({ dur: 0.5 });
    expect(setLeads).not.toHaveBeenCalled();
  });
});

describe("NewCustomerModal — dedup hit", () => {
  it("creates NOTHING and keeps the modal open with the existing-record notice", async () => {
    resolveCreateWith(createdDto({ created: false, id: "existing-9" }));

    render(<NewCustomerModal open />);
    fillNameAndOpenBooking("Gary Waters");
    fireEvent.click(screen.getByRole("button", { name: "Job" }));
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));

    await waitFor(() =>
      expect(screen.getByText(/customer with that phone already exists/i)).toBeTruthy(),
    );
    expect(addJob).not.toHaveBeenCalled();
    expect(addVisit).not.toHaveBeenCalled();
    expect(updateLead).not.toHaveBeenCalled();
    expect(setLeads).not.toHaveBeenCalled();
    expect(closeMock).not.toHaveBeenCalled();
  });
});
