// @vitest-environment jsdom
/**
 * components/modals/po-modal/po-modal.test.tsx
 * The record sheet: chapters closed on arrival, lines lock once the order is no longer a draft,
 * fields write on blur (never per keystroke), status transitions go through the real
 * place/cancel endpoints, and a note with an attachment saves through the shared NoteComposer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PO_LABEL } from "@/features/money/po-defs";
import type { PurchaseOrder } from "@/lib/store/types";

const updatePurchaseOrder = vi.fn();
const removePurchaseOrder = vi.fn();
const appendPONote = vi.fn();
const adoptPurchaseOrder = vi.fn();
const closeMock = vi.fn();

let currentPO: PurchaseOrder;

const basePO = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: "po-1",
  num: null,
  vendor: "Ferguson",
  status: "draft",
  jobId: null,
  jobTitle: null,
  orderedAt: null,
  expectedAt: null,
  shipToAddress: null,
  orderedByUserId: "user-1",
  orderedByName: "Dana",
  freight: 0,
  tax: 0,
  total: 0,
  lines: [{ id: "line-1", description: "3/4in PEX-A", qty: 100, uom: "ft", unitCostMillicents: 21450, amount: 21.45 }],
  createdAt: "2026-08-19T00:00:00.000Z",
  notes: [],
  ...over,
});

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      purchaseOrders: [currentPO],
      jobs: [{ id: "job-1", title: "Henderson repipe" }],
      updatePurchaseOrder,
      removePurchaseOrder,
      appendPONote,
      adoptPurchaseOrder,
    }),
  useCloseModal: () => closeMock,
  useActiveModal: () => ({ id: "po", params: { poId: "po-1" } }),
}));

const placeMutate = vi.fn();
const cancelMutate = vi.fn();
const noteViewUrlMutate = vi.fn();

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      purchasing: {
        place: { mutate: (...a: unknown[]) => placeMutate(...a) },
        cancel: { mutate: (...a: unknown[]) => cancelMutate(...a) },
        noteViewUrl: { mutate: (...a: unknown[]) => noteViewUrlMutate(...a) },
      },
    },
  },
}));

vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { purchasing: { listNotes: { useQuery: () => ({ data: undefined, isFetched: true }) } } } },
}));

const uploadPONoteFile = vi.fn();
vi.mock("@/lib/store/upload-po-note-file", () => ({
  uploadPONoteFile: (...a: unknown[]) => uploadPONoteFile(...a),
  PO_NOTE_ATTACH_ACCEPT: "image/*,.pdf",
}));

// The cents→dollars conversion has its own unit tests (lib/store/dto-mapper.test.ts) — a
// passthrough here keeps this file's fixtures about the MODAL's behavior, not the mapper's.
vi.mock("@/lib/store/dto-mapper", () => ({
  dtoPurchaseOrderToStore: (dto: unknown) => dto,
}));

import { POModal } from "./po-modal";

const openChapter = (index: number) => {
  const heads = document.querySelectorAll(".fsec-h");
  fireEvent.click(heads[index]!);
};

beforeEach(() => {
  vi.clearAllMocks();
  currentPO = basePO();
});

describe("POModal — arrival", () => {
  it("all three chapters arrive closed", () => {
    render(<POModal poId="po-1" />);
    const heads = document.querySelectorAll(".fsec-h");
    expect(heads.length).toBe(3);
    heads.forEach((h) => expect(h.getAttribute("aria-expanded")).toBe("false"));
  });

  it("the vendor is the sheet title, not the PO number", () => {
    render(<POModal poId="po-1" />);
    expect(screen.getByRole("heading", { name: "Ferguson" })).toBeTruthy();
  });

  it("a draft reads 'unnumbered' — a draft has no number to read to a branch", () => {
    render(<POModal poId="po-1" />);
    expect(screen.getByText(/unnumbered/)).toBeTruthy();
  });
});

describe("POModal — Order chapter writes on blur", () => {
  it("typing in the vendor field does not write until it blurs", () => {
    render(<POModal poId="po-1" />);
    openChapter(0);
    const input = screen.getByLabelText("Vendor");
    fireEvent.change(input, { target: { value: "Ferguson Enterprises" } });
    expect(updatePurchaseOrder).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(updatePurchaseOrder).toHaveBeenCalledWith("po-1", { vendor: "Ferguson Enterprises" });
  });

  it("blurring an UNCHANGED vendor value writes nothing", () => {
    render(<POModal poId="po-1" />);
    openChapter(0);
    const input = screen.getByLabelText("Vendor");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(updatePurchaseOrder).not.toHaveBeenCalled();
  });
});

describe("POModal — a cancelled order locks every field", () => {
  // UpdatePurchaseOrderUseCase refuses ANY write to a cancelled order server-side. Leaving these
  // controls enabled meant the user could type, watch it apply optimistically, then watch it
  // roll back with a write-error toast a moment later — an edit-then-revert on a field that
  // should simply have been dead, not a silent failure but not a clean one either.
  beforeEach(() => {
    currentPO = basePO({ status: "cancelled", num: "PO-1044", orderedAt: "2026-08-19" });
  });

  it("the vendor field is disabled", () => {
    render(<POModal poId="po-1" />);
    openChapter(0);
    expect((screen.getByLabelText("Vendor") as HTMLInputElement).disabled).toBe(true);
  });

  it("the For job picker is disabled", () => {
    render(<POModal poId="po-1" />);
    openChapter(0);
    expect((screen.getByLabelText(PO_LABEL.job) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the Expected date is disabled", () => {
    render(<POModal poId="po-1" />);
    openChapter(0);
    expect((screen.getByLabelText(PO_LABEL.expectedAt) as HTMLInputElement).disabled).toBe(true);
  });

  it("the Ship to address field is disabled", () => {
    render(<POModal poId="po-1" />);
    openChapter(0);
    expect((screen.getByLabelText(PO_LABEL.shipTo) as HTMLInputElement).disabled).toBe(true);
  });

  it("Freight and Tax are disabled too — a cancelled order refuses every field", () => {
    render(<POModal poId="po-1" />);
    openChapter(1);
    expect((screen.getByLabelText(PO_LABEL.freight) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(PO_LABEL.tax) as HTMLInputElement).disabled).toBe(true);
  });
});

describe("POModal — Lines chapter", () => {
  it("a draft's lines are editable, with an Add-a-line control", () => {
    render(<POModal poId="po-1" />);
    openChapter(1);
    expect((screen.getByLabelText("Item") as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText("+ Add a line")).toBeTruthy();
  });

  it("lines lock once the order is no longer a draft — no Add, no Remove, disabled inputs", () => {
    currentPO = basePO({ status: "ordered", num: "PO-1044", orderedAt: "2026-08-19" });
    render(<POModal poId="po-1" />);
    openChapter(1);
    expect((screen.getByLabelText("Item") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText("+ Add a line")).toBeNull();
    expect(screen.queryByLabelText(/^Remove/)).toBeNull();
  });

  it("editing a line's qty does not write per keystroke — only once the chapter blurs", () => {
    render(<POModal poId="po-1" />);
    openChapter(1);
    const qty = screen.getByLabelText("Qty");
    fireEvent.focus(qty);
    fireEvent.change(qty, { target: { value: "5" } });
    fireEvent.change(qty, { target: { value: "50" } });
    expect(updatePurchaseOrder).not.toHaveBeenCalled();
    fireEvent.blur(qty);
    expect(updatePurchaseOrder).toHaveBeenCalledTimes(1);
    const [, patch] = updatePurchaseOrder.mock.calls[0] as [string, { lines: Array<{ qty: number }> }];
    expect(patch.lines[0]!.qty).toBe(50);
  });

  it("removing a line commits immediately — a DRAFT's blur carries lines (it may, since it's a draft)", () => {
    render(<POModal poId="po-1" />);
    openChapter(1);
    fireEvent.click(screen.getByLabelText(/^Remove/));
    expect(updatePurchaseOrder).toHaveBeenCalledWith("po-1", { lines: [], freight: 0, tax: 0 });
  });

  /**
   * The bug this covers: freight/tax are ENABLED on a placed order (see the next test), but they
   * live inside the same Lines chapter whose blur used to ALWAYS send `lines` too —
   * UpdatePurchaseOrderUseCase refuses any `lines` once status !== "draft", so editing freight on
   * an ordered PO got a CONFLICT and rolled back with a write error. A test that only asserts
   * `disabled === false` (the one below) cannot catch this — it has to fire an edit through and
   * inspect the actual payload.
   */
  it("editing freight on an ORDERED order writes freight only — no lines key, so it cannot conflict server-side", () => {
    currentPO = basePO({ status: "ordered", num: "PO-1044", orderedAt: "2026-08-19", freight: 0, tax: 12 });
    render(<POModal poId="po-1" />);
    openChapter(1);
    const freightInput = screen.getByLabelText(PO_LABEL.freight);
    fireEvent.focus(freightInput);
    fireEvent.change(freightInput, { target: { value: "45.50" } });
    fireEvent.blur(freightInput);

    expect(updatePurchaseOrder).toHaveBeenCalledTimes(1);
    const [id, patch] = updatePurchaseOrder.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe("po-1");
    expect(patch).not.toHaveProperty("lines");
    expect(patch).toEqual({ freight: 45.5, tax: 12 });
  });

  it("Freight and Tax stay editable once the order is PLACED — only the lines lock", () => {
    // Neither is a promise already made to the vendor, and freight in particular is often
    // quoted late — the real figures are usually only known once the vendor's invoice arrives,
    // which is always AFTER placing. Locking them the way Lines locks would make the field
    // unreachable in exactly the situation it exists for.
    currentPO = basePO({ status: "ordered", num: "PO-1044", orderedAt: "2026-08-19" });
    render(<POModal poId="po-1" />);
    openChapter(1);
    expect((screen.getByLabelText(PO_LABEL.freight) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText(PO_LABEL.tax) as HTMLInputElement).disabled).toBe(false);
  });
});

describe("POModal — Notes chapter", () => {
  it("a note with an attachment saves through the shared NoteComposer", async () => {
    uploadPONoteFile.mockResolvedValue({ path: "o/purchase-orders/po-1/f.jpg", type: "image/jpeg", name: "receipt.jpg" });
    render(<POModal poId="po-1" />);
    openChapter(2);

    const file = new File(["x"], "receipt.jpg", { type: "image/jpeg" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(uploadPONoteFile).toHaveBeenCalledWith("po-1", file));

    fireEvent.change(screen.getByLabelText("Add a note"), { target: { value: "counter pickup receipt" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));

    expect(appendPONote).toHaveBeenCalledWith("po-1", {
      body: "counter pickup receipt",
      attachment: { path: "o/purchase-orders/po-1/f.jpg", type: "image/jpeg", name: "receipt.jpg" },
    });
  });

  it("opening a note's attachment mints a link through purchasing's OWN noteViewUrl", async () => {
    currentPO = basePO({
      notes: [{ id: "note-1", body: "receipt", authorUserId: "user-1", authorName: "Dana", attachment: { path: "p", type: "image/jpeg", name: "receipt.jpg" }, createdAt: "2026-08-19T12:00:00.000Z" }],
    });
    noteViewUrlMutate.mockResolvedValue({ url: "https://signed.example/receipt.jpg" });
    render(<POModal poId="po-1" />);
    openChapter(2);
    fireEvent.click(screen.getByRole("button", { name: "receipt.jpg" }));
    await waitFor(() => expect(noteViewUrlMutate).toHaveBeenCalledWith({ poId: "po-1", id: "note-1" }));
  });
});

describe("POModal — footer transitions", () => {
  it("Delete draft removes the record and closes", () => {
    render(<POModal poId="po-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    expect(removePurchaseOrder).toHaveBeenCalledWith("po-1");
    expect(closeMock).toHaveBeenCalled();
  });

  it("Order it → places the order through v1.purchasing.place and adopts the result", async () => {
    const placedDto = { id: "po-1", status: "ordered", num: "PO-1044" };
    placeMutate.mockResolvedValue(placedDto);
    render(<POModal poId="po-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Order it →" }));
    await waitFor(() => expect(placeMutate).toHaveBeenCalledWith({ poId: "po-1" }));
    await waitFor(() => expect(adoptPurchaseOrder).toHaveBeenCalled());
  });

  it("a placed order offers Cancel order, not Delete draft", () => {
    currentPO = basePO({ status: "ordered", num: "PO-1044", orderedAt: "2026-08-19" });
    render(<POModal poId="po-1" />);
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete draft" })).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("Cancel order calls v1.purchasing.cancel and adopts the result", async () => {
    currentPO = basePO({ status: "ordered", num: "PO-1044", orderedAt: "2026-08-19" });
    cancelMutate.mockResolvedValue({ id: "po-1", status: "cancelled" });
    render(<POModal poId="po-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    await waitFor(() => expect(cancelMutate).toHaveBeenCalledWith({ poId: "po-1" }));
    await waitFor(() => expect(adoptPurchaseOrder).toHaveBeenCalled());
  });

  it("a cancelled order's ghost button reads Close, and Done just closes the sheet", () => {
    currentPO = basePO({ status: "cancelled", num: "PO-1044", orderedAt: "2026-08-19" });
    render(<POModal poId="po-1" />);
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(closeMock).toHaveBeenCalled();
  });
});
