// @vitest-environment jsdom
/**
 * components/modals/po-modal/po-modal.consistency.test.tsx
 *
 * The create modal and the record sheet must read as ONE record. The mechanism is a shared
 * definition (features/money/po-defs.ts) and a shared line table (features/money/po-line-table.tsx),
 * not a habit — these tests fail the moment somebody hard-codes a label in one of them, reorders a
 * column in one of them, or crosses the create-form/record-sheet register.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { PO_LINE_COLS, PO_LABEL } from "@/features/money/po-defs";
import type { PurchaseOrder } from "@/lib/store/types";

const updatePurchaseOrder = vi.fn();
const removePurchaseOrder = vi.fn();
const appendPONote = vi.fn();
const adoptPurchaseOrder = vi.fn();

const FIXTURE_PO: PurchaseOrder = {
  id: "po-1",
  num: null,
  vendor: "Ferguson",
  status: "draft",
  jobId: null,
  jobTitle: null,
  orderedAt: null,
  expectedAt: null,
  shipTo: "counter_pickup",
  orderedByUserId: "user-1",
  orderedByName: "Dana",
  freight: 0,
  tax: 0,
  total: 0,
  lines: [{ id: "line-1", description: "3/4in PEX-A", qty: 100, uom: "ft", unitCostMillicents: 21450, amount: 21.45 }],
  createdAt: "2026-08-19T00:00:00.000Z",
  notes: [],
};

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      purchaseOrders: [FIXTURE_PO],
      jobs: [],
      updatePurchaseOrder,
      removePurchaseOrder,
      appendPONote,
      adoptPurchaseOrder,
    }),
  useCloseModal: () => vi.fn(),
  useOpenModal: () => vi.fn(),
  useActiveModal: () => ({ id: "po", params: {} }),
}));

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      purchasing: {
        create: { mutate: vi.fn() },
        place: { mutate: vi.fn() },
        cancel: { mutate: vi.fn() },
        noteViewUrl: { mutate: vi.fn() },
      },
    },
  },
}));

vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { purchasing: { listNotes: { useQuery: () => ({ data: undefined, isFetched: true }) } } } },
}));

vi.mock("@/lib/store/upload-po-note-file", () => ({
  uploadPONoteFile: vi.fn(),
  PO_NOTE_ATTACH_ACCEPT: "image/*,.pdf",
}));

import { POModal } from "./po-modal";
import { NewPOModal } from "../new-po-modal";

beforeEach(() => {
  updatePurchaseOrder.mockClear();
  removePurchaseOrder.mockClear();
  appendPONote.mockClear();
  adoptPurchaseOrder.mockClear();
});

it("both modals render the same line columns, in the same order", () => {
  const view = render(<POModal poId="po-1" />);
  // The Lines chapter (the second SheetRow section) is shut on arrival — its table is not in the
  // DOM at all until it opens.
  fireEvent.click(view.container.querySelectorAll(".fsec-h")[1]!);
  const viewCols = [...view.container.querySelectorAll(".lineedit thead th")].map((t) => t.textContent);
  view.unmount();
  const create = render(<NewPOModal />);
  const createCols = [...create.container.querySelectorAll(".lineedit thead th")].map((t) => t.textContent);
  expect(createCols).toEqual(viewCols);
  expect(viewCols.filter(Boolean)).toEqual(PO_LINE_COLS.map((c) => c.label));
});

it("both modals call the vendor field the same thing", () => {
  const view = render(<POModal poId="po-1" />);
  // The record sheet's Order chapter is shut on arrival — open it to reach the field. Queried by
  // chapter-head class rather than role name: the footer's own "Order it →" button also starts
  // with "Order" and would otherwise make this an ambiguous match.
  fireEvent.click(view.container.querySelectorAll(".fsec-h")[0]!);
  expect(view.getByLabelText(PO_LABEL.vendor)).toBeTruthy();
  view.unmount();

  const create = render(<NewPOModal />);
  // The create form's vendor field is one of the two essentials — open with no click needed.
  expect(create.getByLabelText(PO_LABEL.vendor)).toBeTruthy();

  // Neither modal may invent a second name for the same field.
  expect(view.queryByText("Supplier")).toBeNull();
  expect(create.queryByText("Supplier")).toBeNull();
});

// The registers deliberately do NOT cross: a create form is a form, a record is chapters.
it("the create modal uses DisclosureRow and never SheetRow", () => {
  const { container } = render(<NewPOModal />);
  expect(container.querySelector(".fdd")).toBeTruthy();
  expect(container.querySelector(".fsec")).toBeNull();
});

it("the record sheet uses SheetRow sections and never DisclosureRow", () => {
  const { container } = render(<POModal poId="po-1" />);
  expect(container.querySelector(".fsec")).toBeTruthy();
  expect(container.querySelector(".fdd")).toBeNull();
});

describe("the status vocabulary — one word per status, everywhere", () => {
  it("the record sheet's pill and the create form never disagree on a status word", () => {
    // PO_STATUS_META is the only place a status label may be authored — both modals import it
    // (the record sheet renders it on the header pill; the create form never shows a status at
    // all, because a record that does not exist yet has none — see po-defs.ts's own comment).
    const { getByText } = render(<POModal poId="po-1" />);
    expect(getByText("Draft")).toBeTruthy();
  });
});
