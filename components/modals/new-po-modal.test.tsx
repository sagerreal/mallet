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

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ jobs: [{ id: "job-1", title: "Henderson repipe" }], adoptPurchaseOrder, appendPONote }),
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

import { NewPOModal } from "./new-po-modal";
import { MODAL } from "@/lib/store/modal-ids";

beforeEach(() => {
  vi.clearAllMocks();
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
    // Open the Notes disclosure and type a note.
    fireEvent.click(screen.getByRole("button", { name: /^Notes/ }));
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "gate code 4482" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    await waitFor(() => expect(appendPONote).toHaveBeenCalledWith("new-po-1", { body: "gate code 4482" }));
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
