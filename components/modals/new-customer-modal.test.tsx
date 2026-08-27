// @vitest-environment jsdom
/**
 * components/modals/new-customer-modal.test.tsx
 * This modal creates a CUSTOMER and nothing else.
 *
 * It used to also book a visit and offer "✦ Build the price →" from the same submit, so one form
 * could mint a customer, a job, an unplaced visit and a composer hand-off. That row is gone and
 * the tests for it went with it — "does not offer to book a visit" below is what stops it coming
 * back by accident.
 *
 * What is left, and pinned here:
 *   "Add customer" → one customer, tags included, list refreshed, modal closed
 *   dedup hit      → nothing created (the phone belongs to someone else), and editing the
 *                    phone releases the lock
 *   the Tags row   → applies SEVERAL tags, and edits the shop's tag list in place
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { NewCustomerModal } from "./new-customer-modal";

// ---- store mock ---------------------------------------------------------------

const addCompany = vi.fn();
const addLeadNote = vi.fn();
const addSource = vi.fn();
const removeSource = vi.fn();
const updateLead = vi.fn();
const setLeads = vi.fn();
const adoptLead = vi.fn();

// Mutable store state. Reset in beforeEach.
const storeState = {
  addCompany,
  addLeadNote,
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

const uploadLeadNoteFile = vi.fn();
vi.mock("@/lib/store/upload-lead-note-file", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  uploadLeadNoteFile: (...a: unknown[]) => uploadLeadNoteFile(...a),
}));

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
    tags: [],
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

function fillName(name: string) {
  fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: name } });
}

beforeEach(() => {
  vi.clearAllMocks();
  closeMock = vi.fn();
  openModalMock = vi.fn();
  storeState.leads = [];
});

// ---- tests ----------------------------------------------------------------------

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
    fillName("Gary Waters");
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));

    await waitFor(() =>
      expect(screen.getByText(/customer with that phone already exists/i)).toBeTruthy(),
    );
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
    fillName("Gary Waters");
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));

    // Close while the create is pending, then let the dedup response land.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(closeMock).toHaveBeenCalled();
    await act(async () => {
      resolveCreate(createdDto({ created: false, id: "existing-9" }));
    });

    expect(screen.queryByText(/customer with that phone already exists/i)).toBeNull();
    expect(setLeads).not.toHaveBeenCalled();
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
// THE TAG LIST IS EDITED WHERE IT IS USED. It used to be a Settings card, which is how a typo
// ("Refferal") survives for a year: the place you notice it and the place you fix it were different
// screens, and only one of them was on the way to anywhere.
// ---------------------------------------------------------------------------

describe("the Tags row", () => {
  // The row is a button whose accessible name is "Tags" plus its current value.
  const openTagsRow = () => fireEvent.click(screen.getByRole("button", { name: /Tags/ }));

  it("sends the applied tags with the create", async () => {
    resolveCreateWith(createdDto());
    render(<NewCustomerModal open />);
    fillName("Gary Waters");
    openTagsRow();
    fireEvent.click(screen.getByRole("button", { name: /^Google/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Referral/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledOnce());
    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["Google", "Referral"] }),
    );
  });

  /**
   * The single-select row this replaced collapsed on choose, which was right when there was one
   * answer. Applying a second tag is the common case, so closing the row after the first would put
   * a re-open between the office and the thing it just started doing.
   */
  it("stays open after a pick, so a second tag needs no re-open", () => {
    render(<NewCustomerModal open />);
    openTagsRow();
    fireEvent.click(screen.getByRole("button", { name: /^Google/ }));
    expect(screen.getByRole("button", { name: /^Referral/ })).toBeTruthy();
  });

  /**
   * Undefined, not `[]`. The column default already writes the empty set, so sending an empty
   * array would be a write that says nothing — and `undefined` is dropped by JSON on the way out,
   * the same convention every other optional field in buildCreateInput uses.
   */
  it("sends no tags value at all when none are applied", async () => {
    resolveCreateWith(createdDto());
    render(<NewCustomerModal open />);
    fillName("Gary Waters");
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledOnce());
    expect(mutateAsyncMock.mock.calls[0]![0].tags).toBeUndefined();
  });

  it("summarises the applied tags on the collapsed row", () => {
    render(<NewCustomerModal open />);
    openTagsRow();
    fireEvent.click(screen.getByRole("button", { name: /^Google/ }));
    expect(screen.getByRole("button", { name: /Tags/ }).textContent).toContain("Google");
  });

  it("removes a tag this shop added", () => {
    storeState.sources = [{ id: "src-1", label: "Home show" }];
    render(<NewCustomerModal open />);
    openTagsRow();

    fireEvent.click(screen.getByRole("button", { name: "Remove Home show from the tag list" }));
    expect(removeSource).toHaveBeenCalledWith("src-1");
  });

  it("offers NO remove on a built-in tag — those are always available", () => {
    storeState.sources = [];
    render(<NewCustomerModal open />);
    openTagsRow();

    expect(screen.queryByRole("button", { name: /^Remove Referral/ })).toBeNull();
  });

  it("unapplies a tag that is removed from the list, so the form cannot save a dead label", () => {
    storeState.sources = [{ id: "src-1", label: "Home show" }];
    render(<NewCustomerModal open />);
    openTagsRow();
    fireEvent.click(screen.getByRole("button", { name: /^Home show/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Home show from the tag list" }));

    expect(screen.getByRole("button", { name: /Tags/ }).textContent).not.toContain("Home show");
  });
});

/**
 * THE ROW THAT IS GONE. This modal minted a customer, a job, an unplaced visit and a composer
 * hand-off from one submit. Intake is intake now; a reintroduced booking control fails here.
 */
describe("NewCustomerModal — no booking", () => {
  it("does not offer to book a visit", () => {
    render(<NewCustomerModal open />);
    expect(screen.queryByText("Book a visit")).toBeNull();
    expect(screen.queryByRole("button", { name: /book a visit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Build the price/ })).toBeNull();
  });

  it("the submit is always 'Add customer' — it never renames itself to Create job", () => {
    render(<NewCustomerModal open />);
    expect(screen.getByRole("button", { name: "Add customer" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create job" })).toBeNull();
  });
});

/**
 * A NOTE MAY CARRY ONE FILE — but nothing can be uploaded until the customer exists, because the
 * signed URL is scoped to a lead id. So the file is staged, and the upload plus the note that
 * points at it happen after the create resolves.
 */
describe("attaching a file to the note", () => {
  const fakeFile = (name: string) => new File(["x"], name, { type: "application/pdf" });

  const pickFile = (file: File) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
  };

  const openMoreDetails = () => fireEvent.click(screen.getByRole("button", { name: /More details/ }));

  it("uploads against the SERVER lead id and writes a note carrying the file", async () => {
    resolveCreateWith(createdDto({ id: "srv-lead-9" }));
    uploadLeadNoteFile.mockResolvedValue({ path: "org/leads/srv-lead-9/x.pdf", type: "application/pdf", name: "permit.pdf" });

    render(<NewCustomerModal open />);
    fillName("Gary Waters");
    openMoreDetails();
    fireEvent.change(screen.getByPlaceholderText("gate code, best time to call…"), {
      target: { value: "permit attached" },
    });
    pickFile(fakeFile("permit.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));

    await waitFor(() => expect(uploadLeadNoteFile).toHaveBeenCalledWith("srv-lead-9", expect.any(File)));
    await waitFor(() => expect(addLeadNote).toHaveBeenCalled());
    const [leadId, note] = addLeadNote.mock.calls[0] as [string, { notes?: string; att?: unknown }];
    expect(leadId).toBe("srv-lead-9");
    // The sentence rides the NOTE, with the file — one entry, not a scalar plus an orphan file.
    expect(note.notes).toBe("permit attached");
    expect(note.att).toMatchObject({ name: "permit.pdf" });
  });

  /** With a file, the text must NOT also go to leads.notes, or the trail shows it twice. */
  it("keeps the sentence off the create payload when it rides a note", async () => {
    resolveCreateWith(createdDto());
    uploadLeadNoteFile.mockResolvedValue({ path: "p", type: "application/pdf", name: "permit.pdf" });

    render(<NewCustomerModal open />);
    fillName("Gary Waters");
    openMoreDetails();
    fireEvent.change(screen.getByPlaceholderText("gate code, best time to call…"), {
      target: { value: "permit attached" },
    });
    pickFile(fakeFile("permit.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledOnce());
    expect(mutateAsyncMock.mock.calls[0]![0].notes).toBeUndefined();
  });

  /** Without a file, nothing changes: the sentence goes to leads.notes exactly as before. */
  it("still writes the sentence to the customer when there is no file", async () => {
    resolveCreateWith(createdDto());
    render(<NewCustomerModal open />);
    fillName("Gary Waters");
    openMoreDetails();
    fireEvent.change(screen.getByPlaceholderText("gate code, best time to call…"), {
      target: { value: "gate code 4482" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledOnce());
    expect(mutateAsyncMock.mock.calls[0]![0].notes).toBe("gate code 4482");
    expect(addLeadNote).not.toHaveBeenCalled();
  });

  /**
   * THE ONE THAT MATTERS. The customer IS saved by the time the upload runs. Closing the modal on
   * a failed upload would lose the file with no trace and leave the office believing it went with
   * them, so it stays open with the reason.
   */
  it("keeps the modal open, with the reason, when the customer saved but the file did not", async () => {
    resolveCreateWith(createdDto());
    uploadLeadNoteFile.mockRejectedValue(new Error("network died"));

    render(<NewCustomerModal open />);
    fillName("Gary Waters");
    openMoreDetails();
    pickFile(fakeFile("permit.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));

    expect(await screen.findByText("That didn't upload — try again.")).toBeTruthy();
    expect(closeMock).not.toHaveBeenCalled();
    expect(addLeadNote).not.toHaveBeenCalled();
    // The list still refreshes: the customer exists and must appear.
    expect(invalidate).toHaveBeenCalled();
  });

  /** A dedup hit is someone else's record — the file must not be hung on it. */
  it("does not attach anything on a dedup hit", async () => {
    resolveCreateWith(createdDto({ created: false, id: "existing-9" }));
    render(<NewCustomerModal open />);
    fillName("Gary Waters");
    openMoreDetails();
    pickFile(fakeFile("permit.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));

    await waitFor(() =>
      expect(screen.getByText(/customer with that phone already exists/i)).toBeTruthy(),
    );
    expect(uploadLeadNoteFile).not.toHaveBeenCalled();
    expect(addLeadNote).not.toHaveBeenCalled();
  });
});
