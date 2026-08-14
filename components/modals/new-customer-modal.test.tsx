// @vitest-environment jsdom
/**
 * components/modals/new-customer-modal.test.tsx
 * The submit button must actually create the booked work it names:
 *   "Create job" (booking on) → a real unpriced job (kind estimate) + one unplaced
 *   visit, attached after the persist reconcile — the one-job-type model
 *   dedup hit               → NO work created (the phone belongs to someone else),
 *                             and editing the phone releases the lock
 *   "Build the price"       → customer ONLY, then the composer (?lead=) — the job
 *                             is born when the quote is accepted, never before
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { NewCustomerModal } from "./new-customer-modal";

// ---- router mock ----------------------------------------------------------------

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

// ---- store mock ---------------------------------------------------------------

const addJob = vi.fn();
const addVisit = vi.fn();
const addCompany = vi.fn();
const addSource = vi.fn();
const removeSource = vi.fn();
const updateLead = vi.fn();
const setLeads = vi.fn();
const adoptLead = vi.fn();

// Mutable store state — tests may push leads in to exercise the "already in
// store" estimate path. Reset in beforeEach.
const storeState = {
  addJob,
  addVisit,
  addCompany,
  addSource,
  removeSource,
  updateLead,
  setLeads,
  adoptLead,
  companies: [] as unknown[],
  sources: [] as unknown[],
  leads: [] as { id: string }[],
};

let closeMock = vi.fn();
let openModalMock = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useCloseModal: () => closeMock,
  useOpenModal: () => openModalMock,
  usePushModal: () => openModalMock,
  useActiveModal: () => null,
  useAppStore: Object.assign(
    (selector: (s: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState },
  ),
}));

// ---- trpc mock ------------------------------------------------------------------

const invalidate = vi.fn();
const mutateAsyncMock = vi.fn();

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { customers: { invalidate, list: { invalidate } } } }),
    v1: {
      customers: {
        create: { useMutation: () => ({ mutateAsync: mutateAsyncMock, isPending: false }) },
      },
    },
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

/** mutateAsync(input) → resolve with the given DTO. */
function resolveCreateWith(dto: ReturnType<typeof createdDto>) {
  mutateAsyncMock.mockResolvedValue(dto);
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

describe("NewCustomerModal — submit with a booked visit", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Yes — book a visit" }));
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));

    await waitFor(() => expect(addJob).toHaveBeenCalledOnce());
    expect(addJob).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "srv-lead-1", title: "leaky spigot", kind: "estimate" }),
    );
    // The default unplaced visit only attaches AFTER the job persist reconciles.
    expect(addVisit).not.toHaveBeenCalled();
    resolvePersist();
    await waitFor(() => expect(addVisit).toHaveBeenCalledWith("job-1", 0.5));
    await waitFor(() => expect(closeMock).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalled();
  });

  it("passes the single top-level Service address to the booked job's addr", async () => {
    resolveCreateWith(createdDto());
    addJob.mockReturnValue({ job: { id: "job-1" }, persisted: Promise.resolve() });

    render(<NewCustomerModal open />);
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Gary Waters" } });
    // Fill the one Service address field (the top autocomplete input).
    fireEvent.change(screen.getByLabelText("Service address"), {
      target: { value: "742 Evergreen Terrace, Springfield" },
    });
    fireEvent.click(screen.getByText("Book a visit"));
    fireEvent.click(screen.getByRole("button", { name: "Yes — book a visit" }));
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));

    await waitFor(() => expect(addJob).toHaveBeenCalledOnce());
    expect(addJob).toHaveBeenCalledWith(
      expect.objectContaining({ addr: "742 Evergreen Terrace, Springfield" }),
    );
    // The customer create also carries that address (single source of truth).
    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ address: "742 Evergreen Terrace, Springfield" }),
    );
  });

  it("keeps the modal open with an error when the job persist fails (customer already created)", async () => {
    resolveCreateWith(createdDto());
    addJob.mockReturnValue({
      job: { id: "job-1" },
      persisted: Promise.reject(new Error("db down")),
    });

    render(<NewCustomerModal open />);
    fillNameAndOpenBooking("Gary Waters");
    fireEvent.click(screen.getByRole("button", { name: "Yes — book a visit" }));
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));

    await waitFor(() =>
      expect(screen.getByText(/customer was saved, but the job wasn't/i)).toBeTruthy(),
    );
    // No silent close — the office must see the failure and be able to retry.
    expect(closeMock).not.toHaveBeenCalled();
    expect(addVisit).not.toHaveBeenCalled();
    // The customer row DID persist — the list refresh must still happen.
    expect(invalidate).toHaveBeenCalled();
  });

  it("double-fired submit creates ONE customer and ONE job", async () => {
    resolveCreateWith(createdDto());
    addJob.mockReturnValue({ job: { id: "job-1" }, persisted: Promise.resolve() });

    render(<NewCustomerModal open />);
    fillNameAndOpenBooking("Gary Waters");
    fireEvent.click(screen.getByRole("button", { name: "Yes — book a visit" }));
    const submit = screen.getByRole("button", { name: "Create job" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(closeMock).toHaveBeenCalled());
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(addJob).toHaveBeenCalledTimes(1);
  });
});

describe("NewCustomerModal — Build the price (customer only, then the composer)", () => {
  // This modal books no schedule (its jobs are created unscheduled with an
  // unplaced visit), so Build-the-price never drops a chosen time by skipping
  // the job. Booked work stays on the "Create job" submit button.

  it("creates the CUSTOMER ONLY and routes to the composer with the lead id — no job, no builder modal", async () => {
    resolveCreateWith(createdDto());

    render(<NewCustomerModal open />);
    fillNameAndOpenBooking("Gary Waters");
    fireEvent.click(screen.getByRole("button", { name: "Yes — book a visit" }));
    fireEvent.click(screen.getByRole("button", { name: /Build the price/ }));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/composer?lead=srv-lead-1"));
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(addJob).not.toHaveBeenCalled();
    expect(addVisit).not.toHaveBeenCalled();
    expect(openModalMock).not.toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
    // The composer reads the lead from the store — the created DTO is adopted
    // (no network re-write) so the selector resolves it immediately.
    expect(adoptLead).toHaveBeenCalledWith(expect.objectContaining({ id: "srv-lead-1" }));
    expect(invalidate).toHaveBeenCalled();
  });

  it("carries the typed job description to the composer as ?desc=", async () => {
    resolveCreateWith(createdDto());

    render(<NewCustomerModal open />);
    fillNameAndOpenBooking("Gary Waters");
    fireEvent.change(screen.getByPlaceholderText("water heater making noise"), {
      target: { value: "swap 50-gal water heater" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Yes — book a visit" }));
    fireEvent.click(screen.getByRole("button", { name: /Build the price/ }));

    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(
        `/composer?lead=srv-lead-1&desc=${encodeURIComponent("swap 50-gal water heater")}`,
      ),
    );
    expect(addJob).not.toHaveBeenCalled();
  });

  it("double-click creates ONE customer and routes once", async () => {
    resolveCreateWith(createdDto());

    render(<NewCustomerModal open />);
    fillNameAndOpenBooking("Gary Waters");
    fireEvent.click(screen.getByRole("button", { name: "Yes — book a visit" }));
    const build = screen.getByRole("button", { name: /Build the price/ });
    fireEvent.click(build);
    fireEvent.click(build);

    await waitFor(() => expect(routerPush).toHaveBeenCalledTimes(1));
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(addJob).not.toHaveBeenCalled();
  });

  it("a dedup hit on Build the price shows the notice and does NOT route to the composer", async () => {
    resolveCreateWith(createdDto({ created: false, id: "existing-9" }));

    render(<NewCustomerModal open />);
    fillNameAndOpenBooking("Gary Waters");
    fireEvent.click(screen.getByRole("button", { name: "Yes — book a visit" }));
    fireEvent.click(screen.getByRole("button", { name: /Build the price/ }));

    await waitFor(() =>
      expect(screen.getByText(/customer with that phone already exists/i)).toBeTruthy(),
    );
    expect(routerPush).not.toHaveBeenCalled();
    expect(adoptLead).not.toHaveBeenCalled();
    expect(addJob).not.toHaveBeenCalled();
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("shows a pending state while the create round-trip is in flight", async () => {
    let resolveCreate: (d: unknown) => void = () => {};
    mutateAsyncMock.mockReturnValue(new Promise((res) => { resolveCreate = res; }));

    render(<NewCustomerModal open />);
    fillNameAndOpenBooking("Gary Waters");
    fireEvent.click(screen.getByRole("button", { name: "Yes — book a visit" }));
    fireEvent.click(screen.getByRole("button", { name: /Build the price/ }));

    const pending = (await screen.findByRole("button", { name: "Creating…" })) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);

    await act(async () => {
      resolveCreate(createdDto());
    });
    expect(routerPush).toHaveBeenCalledWith("/composer?lead=srv-lead-1");
  });
});

describe("NewCustomerModal — the booked visit is an unpriced job", () => {
  it("creates a REAL estimate job with one unplaced visit — never a store-local evisit", async () => {
    resolveCreateWith(createdDto());

    render(<NewCustomerModal open />);
    fillNameAndOpenBooking("Gary Waters");
    fireEvent.change(screen.getByPlaceholderText("water heater making noise"), {
      target: { value: "quote a repipe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Yes — book a visit" }));
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));

    await waitFor(() => expect(addJob).toHaveBeenCalledOnce());
    const [draft] = addJob.mock.calls[0] as [{ svc: string; leadId: string; title: string }];
    expect(draft).toMatchObject({ kind: "estimate", leadId: "srv-lead-1", title: "quote a repipe" });
    await waitFor(() => expect(addVisit).toHaveBeenCalledOnce());
    // No store-local evisit path anymore — it vanished on refresh and was invisible
    // to the schedule window and crew-load checks.
    expect(setLeads).not.toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
  });
});

describe("NewCustomerModal — phone validation", () => {
  it("blocks submit inline on an invalid 8-digit phone — no create call at all", () => {
    render(<NewCustomerModal open />);
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Gary Waters" } });
    fireEvent.change(screen.getByPlaceholderText("(925) 555-0123"), {
      target: { value: "78138501" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));

    expect(screen.getByText(/that phone number isn't valid/i)).toBeTruthy();
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it("clears the inline phone error as soon as the field is edited", () => {
    render(<NewCustomerModal open />);
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Gary Waters" } });
    const phoneInput = screen.getByPlaceholderText("(925) 555-0123");
    fireEvent.change(phoneInput, { target: { value: "78138501" } });
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));
    expect(screen.getByText(/that phone number isn't valid/i)).toBeTruthy();

    fireEvent.change(phoneInput, { target: { value: "9255550123" } });
    expect(screen.queryByText(/that phone number isn't valid/i)).toBeNull();
  });

  it("a blank phone is fine — it's optional", async () => {
    resolveCreateWith(createdDto());
    render(<NewCustomerModal open />);
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Gary Waters" } });
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledOnce());
    expect(screen.queryByText(/that phone number isn't valid/i)).toBeNull();
  });

  it("names the server's own validation reason instead of blaming the connection (BAD_REQUEST)", async () => {
    mutateAsyncMock.mockRejectedValue({
      message: 'invalid US phone number: "78138501"',
      data: { code: "BAD_REQUEST" },
    });
    render(<NewCustomerModal open />);
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Gary Waters" } });
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));

    await waitFor(() => {
      expect(screen.getByText(/invalid US phone number/i)).toBeTruthy();
    });
    expect(screen.queryByText(/check your connection/i)).toBeNull();
  });

  it("still blames the connection for a genuine network failure (no server data shape)", async () => {
    mutateAsyncMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<NewCustomerModal open />);
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Gary Waters" } });
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));

    await waitFor(() => {
      expect(screen.getByText(/check your connection/i)).toBeTruthy();
    });
  });
});

describe("NewCustomerModal — dedup hit", () => {
  it("creates NOTHING and keeps the modal open with the existing-record notice", async () => {
    resolveCreateWith(createdDto({ created: false, id: "existing-9" }));

    render(<NewCustomerModal open />);
    fillNameAndOpenBooking("Gary Waters");
    fireEvent.click(screen.getByRole("button", { name: "Yes — book a visit" }));
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

  it("editing the phone releases the dedup lock — notice gone, submit enabled, resubmit fires", async () => {
    resolveCreateWith(createdDto({ created: false, id: "existing-9" }));

    render(<NewCustomerModal open />);
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Gary Waters" } });
    const phoneInput = screen.getByPlaceholderText("(925) 555-0123");
    fireEvent.change(phoneInput, { target: { value: "9255550100" } });
    const submit = screen.getByRole("button", { name: "Add customer" }) as HTMLButtonElement;
    fireEvent.click(submit);

    // Dedup hit: notice shown, submit locked.
    await waitFor(() =>
      expect(screen.getByText(/customer with that phone already exists/i)).toBeTruthy(),
    );
    expect(submit.disabled).toBe(true);

    // The office edits the phone to a NEW number — the notice describes a
    // submission that no longer exists, so it must clear and the form unlock.
    fireEvent.change(phoneInput, { target: { value: "9255550199" } });
    expect(screen.queryByText(/customer with that phone already exists/i)).toBeNull();
    expect(submit.disabled).toBe(false);

    // Resubmitting fires the create mutation again with the new number.
    resolveCreateWith(createdDto({ id: "srv-lead-2", phone: "9255550199" }));
    fireEvent.click(submit);
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(2));
    expect(mutateAsyncMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ phone: "9255550199" }),
    );
    await waitFor(() => expect(closeMock).toHaveBeenCalled());
  });

  it("a dedup response landing AFTER the modal was closed does not re-arm the notice", async () => {
    // The create is still in flight when the office cancels out of the modal —
    // the late `created:false` must be dropped, not parked as a stale notice
    // that disables the submit button on the next open.
    let resolveCreate: (d: unknown) => void = () => {};
    mutateAsyncMock.mockReturnValue(new Promise((res) => { resolveCreate = res; }));

    render(<NewCustomerModal open />);
    fillNameAndOpenBooking("Gary Waters");
    fireEvent.click(screen.getByRole("button", { name: "Yes — book a visit" }));
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));

    // Close while the create is pending, then let the dedup response land.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(closeMock).toHaveBeenCalled();
    await act(async () => {
      resolveCreate(createdDto({ created: false, id: "existing-9" }));
    });

    expect(screen.queryByText(/customer with that phone already exists/i)).toBeNull();
    expect(addJob).not.toHaveBeenCalled();
  });
});

describe("NewCustomerModal — two-button sheet foot (#362)", () => {
  // .sheet-pri is width:100% at the class level; beside Cancel that over-constrains
  // the flex line. The cure: Cancel keeps its intrinsic width (flexShrink 0),
  // the primary takes the remaining space (flex 1, width auto).
  it("Cancel keeps its intrinsic width and the create primary takes the remaining space", () => {
    render(<NewCustomerModal open />);
    const cancel = document.querySelector<HTMLButtonElement>(".sheet-foot .btn.ghost");
    const pri = document.querySelector<HTMLButtonElement>(".sheet-foot .sheet-pri");
    expect(cancel).toBeTruthy();
    expect(pri).toBeTruthy();
    expect(cancel?.style.flexShrink).toBe("0");
    expect(cancel?.style.minHeight).toBe("44px");
    expect(pri?.style.flexGrow).toBe("1");
    expect(pri?.style.width).toBe("auto");
  });
});

// ---------------------------------------------------------------------------
// THE SOURCE LIST IS EDITED WHERE IT IS USED. It used to be a Settings card, which is how a typo
// ("Refferal") survives for a year: the place you notice it and the place you fix it were different
// screens, and only one of them was on the way to anywhere.
// ---------------------------------------------------------------------------

describe("editing the lead source list from the picker", () => {
  // The row is a button whose accessible name is "Lead source" plus its current value.
  const openSourceRow = () => fireEvent.click(screen.getByRole("button", { name: /Lead source/ }));

  it("removes a source this shop added", () => {
    storeState.sources = [{ id: "src-1", label: "Home show" }];
    render(<NewCustomerModal open />);
    openSourceRow();

    fireEvent.click(screen.getByRole("button", { name: "Remove Home show from the source list" }));
    expect(removeSource).toHaveBeenCalledWith("src-1");
  });

  it("offers NO remove on a built-in source — those are always available", () => {
    storeState.sources = [];
    render(<NewCustomerModal open />);
    openSourceRow();

    expect(screen.queryByRole("button", { name: /^Remove Referral/ })).toBeNull();
  });

  it("clears the selection when the chosen source is the one removed", () => {
    // Otherwise the form would carry a source that is no longer on the list, and save it.
    storeState.sources = [{ id: "src-1", label: "Home show" }];
    render(<NewCustomerModal open />);
    openSourceRow();
    fireEvent.click(screen.getByRole("button", { name: "Home show" }));
    // Choosing collapses the row, so reopen it to reach the remove.
    openSourceRow();
    fireEvent.click(screen.getByRole("button", { name: "Remove Home show from the source list" }));

    expect(screen.getByRole("button", { name: /Lead source/ }).textContent).not.toContain("Home show");
  });
});
