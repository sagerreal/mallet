// @vitest-environment jsdom
/**
 * components/modals/new-po-modal.test.tsx
 * The create form: no type="submit" control, validation before any network call, the two-step
 * create-then-place round trip (and what happens when only the second step fails), and staged
 * DisclosureRows for everything past the two essentials.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const adoptPurchaseOrder = vi.fn();
const appendPONote = vi.fn();
const closeMock = vi.fn();
const openModalMock = vi.fn();

let storePurchaseOrders: Array<{ vendor: string }> = [];

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      jobs: [{ id: "job-1", title: "Henderson repipe", addr: "123 Main St, Springfield" }],
      leads: [],
      purchaseOrders: storePurchaseOrders,
      adoptPurchaseOrder,
      appendPONote,
    }),
  useCloseModal: () => closeMock,
  useOpenModal: () => openModalMock,
}));

const createMutate = vi.fn();
const placeMutate = vi.fn();

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      purchasing: {
        create: { mutate: (...a: unknown[]) => createMutate(...a) },
        place: { mutate: (...a: unknown[]) => placeMutate(...a) },
      },
    },
  },
}));

vi.mock("@/lib/store/dto-mapper", () => ({
  dtoPurchaseOrderToStore: (dto: unknown) => dto,
}));

const uploadPONoteFileMock = vi.fn();
vi.mock("@/lib/store/upload-po-note-file", () => ({
  uploadPONoteFile: (...a: unknown[]) => uploadPONoteFileMock(...a),
  PO_NOTE_ATTACH_ACCEPT: ".jpg,.jpeg,.png,.webp,.heic,.pdf,.csv,.txt",
}));

import { NewPOModal } from "./new-po-modal";
import { MODAL } from "@/lib/store/modal-ids";

beforeEach(() => {
  vi.clearAllMocks();
  storePurchaseOrders = [];
  uploadPONoteFileMock.mockReset();
});

describe("NewPOModal — the form itself", () => {
  it("has no type=submit control anywhere — Enter must never place an order", () => {
    const { container } = render(<NewPOModal />);
    expect(container.querySelector('[type="submit"]')).toBeNull();
  });

  it("opens with the two essentials visible and everything else staged", () => {
    render(<NewPOModal />);
    expect(screen.getByLabelText("Vendor")).toBeTruthy();
    expect(screen.getByLabelText("For job")).toBeTruthy();
    // Staged rows read the CURRENT value, never a hint, on arrival.
    expect(screen.getByText("not set")).toBeTruthy();
    expect(screen.getByText("none")).toBeTruthy();
  });

  it("refuses to submit with no vendor", () => {
    render(<NewPOModal />);
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    expect(screen.getByText(/needs a vendor/)).toBeTruthy();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("a draft may be saved with zero lines — only PLACING requires one", () => {
    render(<NewPOModal />);
    fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: "Ferguson" } });
    // The single starter line has a blank description — filtered out on submit, leaving zero
    // lines, which is fine for a draft (only place() requires at least one — see po-defs.ts).
    createMutate.mockResolvedValue({ id: "new-po-1" });
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    expect(createMutate).toHaveBeenCalled();
    const [input] = createMutate.mock.calls[0] as [{ lines: unknown[] }];
    expect(input.lines).toEqual([]);
  });

  it("refuses to PLACE an order with nothing on it", () => {
    render(<NewPOModal />);
    fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: "Ferguson" } });
    fireEvent.click(screen.getByRole("button", { name: "Order it →" }));
    expect(screen.getByText(/cannot be placed/)).toBeTruthy();
    expect(createMutate).not.toHaveBeenCalled();
  });
});

describe("NewPOModal — vendor suggestions come from the store, never a fixture list", () => {
  it("a shop's first order offers an empty datalist — that is correct, not a bug", () => {
    storePurchaseOrders = [];
    render(<NewPOModal />);
    expect(document.querySelectorAll("#po-vendors option").length).toBe(0);
  });

  it("suggests distinct vendors already used, sorted, never a hardcoded demo list", () => {
    storePurchaseOrders = [{ vendor: "Winsupply" }, { vendor: "Ferguson" }, { vendor: "Ferguson" }];
    render(<NewPOModal />);
    const options = [...document.querySelectorAll("#po-vendors option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["Ferguson", "Winsupply"]);
    expect(options).not.toContain("Home Depot");
    expect(options).not.toContain("SupplyHouse");
  });
});

describe("NewPOModal — save as draft", () => {
  it("creates a draft, adopts it, and opens its record sheet", async () => {
    createMutate.mockResolvedValue({ id: "new-po-1", vendor: "Ferguson", status: "draft" });
    render(<NewPOModal />);
    fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: "Ferguson" } });
    fireEvent.change(screen.getByLabelText("Item"), { target: { value: "3/4in PEX-A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledOnce());
    const [input] = createMutate.mock.calls[0] as [{ vendor: string; lines: Array<{ description: string }> }];
    expect(input.vendor).toBe("Ferguson");
    expect(input.lines[0]!.description).toBe("3/4in PEX-A");

    await waitFor(() => expect(adoptPurchaseOrder).toHaveBeenCalledWith({ id: "new-po-1", vendor: "Ferguson", status: "draft" }));
    expect(placeMutate).not.toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
    expect(openModalMock).toHaveBeenCalledWith(MODAL.PO, { poId: "new-po-1" });
  });

  it("a note typed on create is appended AFTER the record exists", async () => {
    createMutate.mockResolvedValue({ id: "new-po-1" });
    render(<NewPOModal />);
    fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: "Ferguson" } });
    fireEvent.change(screen.getByLabelText("Item"), { target: { value: "3/4in PEX-A" } });
    // Open the Notes disclosure — it's the shared NoteComposer now, same control the record
    // sheet renders. Typing + its own "Add note" STAGES the text locally (there is no record yet
    // to append to); "Save as draft" is what actually flushes it.
    fireEvent.click(screen.getByRole("button", { name: /^Notes/ }));
    fireEvent.change(screen.getByLabelText("Add a note"), { target: { value: "gate code 4482" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    await waitFor(() => expect(appendPONote).toHaveBeenCalledWith("new-po-1", { body: "gate code 4482" }));
  });

  it("a file staged on create uploads AFTER the record exists, and rides the same note", async () => {
    createMutate.mockResolvedValue({ id: "new-po-1" });
    uploadPONoteFileMock.mockResolvedValue({ path: "org/purchase-orders/new-po-1/receipt.pdf", type: "application/pdf", name: "receipt.pdf" });
    render(<NewPOModal />);
    fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: "Ferguson" } });
    fireEvent.change(screen.getByLabelText("Item"), { target: { value: "3/4in PEX-A" } });
    fireEvent.click(screen.getByRole("button", { name: /^Notes/ }));
    const file = new File(["x"], "receipt.pdf", { type: "application/pdf" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("receipt.pdf")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));

    // Uploaded against the REAL id, not before it existed.
    await waitFor(() => expect(uploadPONoteFileMock).toHaveBeenCalledWith("new-po-1", file));
    await waitFor(() =>
      expect(appendPONote).toHaveBeenCalledWith("new-po-1", {
        body: "",
        attachment: { path: "org/purchase-orders/new-po-1/receipt.pdf", type: "application/pdf", name: "receipt.pdf" },
      }),
    );
  });
});

describe("NewPOModal — ship-to prefill", () => {
  function pickJob() {
    // "For job" is a SelectMenu (a button + listbox, not a native <select>) — open it, then
    // commit the option via mousedown, same interaction select-menu.test.tsx itself uses.
    fireEvent.click(screen.getByLabelText("For job"));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Henderson repipe" }));
  }

  it("defaults Ship to from the picked job's service address, while the field is still empty", () => {
    render(<NewPOModal />);
    fireEvent.click(screen.getByRole("button", { name: /^Ship to/ }));
    // Picking the job fills Ship to from the job's own address (jobAddr) — the whole reason a
    // dropdown was chosen originally was that free text never got this right on its own.
    pickJob();
    expect((screen.getByLabelText("Ship to") as HTMLInputElement).value).toBe("123 Main St, Springfield");
  });

  it("never overwrites an address someone already typed", () => {
    render(<NewPOModal />);
    fireEvent.click(screen.getByRole("button", { name: /^Ship to/ }));
    fireEvent.change(screen.getByLabelText("Ship to"), { target: { value: "Will-call, counter B" } });
    pickJob();
    expect((screen.getByLabelText("Ship to") as HTMLInputElement).value).toBe("Will-call, counter B");
  });
});

describe("NewPOModal — order it now", () => {
  it("creates the draft, then places it, adopting the PLACED dto", async () => {
    createMutate.mockResolvedValue({ id: "new-po-1", status: "draft" });
    placeMutate.mockResolvedValue({ id: "new-po-1", status: "ordered", num: "PO-1044" });
    render(<NewPOModal />);
    fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: "Ferguson" } });
    fireEvent.change(screen.getByLabelText("Item"), { target: { value: "3/4in PEX-A" } });
    fireEvent.click(screen.getByRole("button", { name: "Order it →" }));

    await waitFor(() => expect(placeMutate).toHaveBeenCalledWith({ poId: "new-po-1" }));
    await waitFor(() =>
      expect(adoptPurchaseOrder).toHaveBeenLastCalledWith({ id: "new-po-1", status: "ordered", num: "PO-1044" }),
    );
    expect(openModalMock).toHaveBeenCalledWith(MODAL.PO, { poId: "new-po-1" });
  });

  it("a failed PLACE still keeps the draft — no duplicate create, the sheet opens with the error named", async () => {
    createMutate.mockResolvedValue({ id: "new-po-1", status: "draft" });
    placeMutate.mockRejectedValue(new Error("Add a line before placing the order."));
    render(<NewPOModal />);
    fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: "Ferguson" } });
    fireEvent.change(screen.getByLabelText("Item"), { target: { value: "3/4in PEX-A" } });
    fireEvent.click(screen.getByRole("button", { name: "Order it →" }));

    await waitFor(() => expect(placeMutate).toHaveBeenCalledOnce());
    // The draft that DID succeed is adopted regardless of the place() failure.
    await waitFor(() => expect(adoptPurchaseOrder).toHaveBeenCalledWith({ id: "new-po-1", status: "draft" }));
    expect(createMutate).toHaveBeenCalledOnce();
    expect(openModalMock).toHaveBeenCalledWith(MODAL.PO, { poId: "new-po-1" });
  });
});
