// @vitest-environment jsdom
/**
 * features/money/orders-panel.test.tsx
 * The Purchase orders list: the four list states, the toolbar (search + "N of M"), the status
 * chips, the row cells, per-row actions, and the Placed/In draft footer — reworked to match
 * invoices' own list (money-ledger.tsx/money-toolbar.tsx) after Owen's review of the shipped
 * feature ("look at the sizing of invoices … purchase order is just not the same").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { OrdersPanel } from "./orders-panel";
import type { PurchaseOrder } from "@/lib/store/types";

let mockPurchaseOrders: PurchaseOrder[] = [];
let mockQuery: { isFetched: boolean; isError: boolean; isRefetching: boolean; refetch: () => void } = {
  isFetched: true,
  isError: false,
  isRefetching: false,
  refetch: vi.fn(),
};
const openModalMock = vi.fn();
const adoptPurchaseOrder = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { purchaseOrders: PurchaseOrder[]; adoptPurchaseOrder: typeof adoptPurchaseOrder }) => unknown) =>
    sel({ purchaseOrders: mockPurchaseOrders, adoptPurchaseOrder }),
  useOpenModal: () => openModalMock,
}));
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { purchasing: { list: { useQuery: () => mockQuery } } } },
}));

const placeMutate = vi.fn();
vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: { v1: { purchasing: { place: { mutate: (...a: unknown[]) => placeMutate(...a) } } } },
}));
vi.mock("@/lib/store/dto-mapper", () => ({
  dtoPurchaseOrderToStore: (dto: unknown) => dto,
}));

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: "po-1",
  num: "PO-1043",
  vendor: "Ferguson",
  status: "ordered",
  jobId: "job-1",
  jobTitle: "Henderson repipe",
  orderedAt: "2026-08-19",
  expectedAt: "2026-08-22",
  shipToAddress: null,
  orderedByUserId: "user-1",
  orderedByName: "Dana",
  freight: 42,
  tax: 68.9,
  total: 952.7,
  lines: [],
  createdAt: "2026-08-19T00:00:00.000Z",
  notes: [],
  ...over,
});

beforeEach(() => {
  openModalMock.mockClear();
  adoptPurchaseOrder.mockClear();
  placeMutate.mockReset();
  mockPurchaseOrders = [
    po({ id: "po-1", num: "PO-1043", vendor: "Ferguson", status: "ordered", total: 952.7 }),
    po({
      id: "po-2",
      num: null,
      vendor: "SupplyHouse",
      status: "draft",
      jobTitle: null,
      orderedAt: null,
      total: 2140,
    }),
    po({ id: "po-3", num: "PO-1038", vendor: "Home Depot", status: "cancelled", jobTitle: "Kim service call", total: 160 }),
  ];
  mockQuery = { isFetched: true, isError: false, isRefetching: false, refetch: vi.fn() };
});

describe("OrdersPanel — heading and header", () => {
  it("reads 'Purchase orders', not 'Orders'", () => {
    render(<OrdersPanel />);
    expect(screen.getByRole("heading", { name: "Purchase orders" })).toBeTruthy();
  });

  it("the header's + New purchase order button opens the create modal", () => {
    render(<OrdersPanel />);
    fireEvent.click(screen.getByRole("button", { name: "+ New purchase order" }));
    expect(openModalMock).toHaveBeenCalledWith("new-po");
  });
});

describe("OrdersPanel — populated", () => {
  it("renders the list columns in order and the row values", () => {
    render(<OrdersPanel />);
    const headers = Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent);
    // The trailing action column's header is a bare, unlabeled th (same shape money-table.tsx's
    // own action column uses) — sliced off before comparing to the labeled columns.
    expect(headers.slice(0, 6)).toEqual(["#", "Vendor", "For job", "Status", "Total", "Ordered"]);

    expect(screen.getByText("PO-1043")).toBeTruthy();
    expect(screen.getByText("Ferguson")).toBeTruthy();
    expect(screen.getByText("Henderson repipe")).toBeTruthy();
    const row = screen.getByText("PO-1043").closest("tr")!;
    expect(within(row).getByText("$952.70")).toBeTruthy();
    expect(within(row).getByText("2026-08-19")).toBeTruthy();
  });

  it("a draft with no number and no job reads — and stock, not blank", () => {
    render(<OrdersPanel />);
    expect(screen.getByText("stock")).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("never re-sorts — renders in the store's order (server createdAt desc)", () => {
    render(<OrdersPanel />);
    const vendors = Array.from(document.querySelectorAll("tbody tr td[data-primary] b")).map((n) => n.textContent);
    expect(vendors).toEqual(["Ferguson", "SupplyHouse", "Home Depot"]);
  });

  it("status chips filter the rows and carry counts", () => {
    render(<OrdersPanel />);
    const chips = screen.getByRole("group", { name: "Filter purchase orders" });
    expect(within(chips).getByRole("button", { name: /^Draft/ }).textContent).toContain("(1)");
    expect(within(chips).getByRole("button", { name: /^Ordered/ }).textContent).toContain("(1)");
    expect(within(chips).getByRole("button", { name: /^Cancelled/ }).textContent).toContain("(1)");

    fireEvent.click(within(chips).getByRole("button", { name: /^Draft/ }));
    expect(screen.getByText("SupplyHouse")).toBeTruthy();
    expect(screen.queryByText("Ferguson")).toBeNull();
  });

  it("marks the active chip with the list-filter selected class", () => {
    render(<OrdersPanel />);
    const chips = screen.getByRole("group", { name: "Filter purchase orders" });
    const draft = within(chips).getByRole("button", { name: /^Draft/ });
    fireEvent.click(draft);
    expect(draft.className.split(" ")).toContain("on");
    expect(within(chips).getByRole("button", { name: /^All/ }).className.split(" ")).not.toContain("on");
  });

  it("clicking a row opens that order's record sheet", () => {
    render(<OrdersPanel />);
    fireEvent.click(screen.getByText("Ferguson").closest("tr")!);
    expect(openModalMock).toHaveBeenCalledWith("po", { poId: "po-1" });
  });

  it("the footer totals PLACED orders in red and DRAFT orders plainly, over the whole book", () => {
    const { container } = render(<OrdersPanel />);
    const footerAmounts = Array.from(container.querySelectorAll(".muted b")).map((b) => b.textContent);
    expect(footerAmounts).toEqual(["$952.70", "$2,140.00"]);
    expect((footerAmounts.length ? container.querySelector(".muted b") : null)?.getAttribute("style")).toContain(
      "color: var(--red)",
    );
  });

  it("footer totals stay fixed to the whole book even while a chip filters the rows", () => {
    const { container } = render(<OrdersPanel />);
    const chips = screen.getByRole("group", { name: "Filter purchase orders" });
    fireEvent.click(within(chips).getByRole("button", { name: /^Cancelled/ }));
    const footerAmounts = Array.from(container.querySelectorAll(".muted b")).map((b) => b.textContent);
    expect(footerAmounts).toEqual(["$952.70", "$2,140.00"]);
  });
});

describe("OrdersPanel — toolbar: search and the N of M count", () => {
  it("shows every row's count against the whole book when nothing is filtered", () => {
    render(<OrdersPanel />);
    expect(screen.getByText("3 of 3")).toBeTruthy();
  });

  it("searches vendor, PO number, and job title, client-side", () => {
    render(<OrdersPanel />);
    const search = screen.getByLabelText("Search purchase orders");

    fireEvent.change(search, { target: { value: "ferguson" } });
    expect(screen.getByText("Ferguson")).toBeTruthy();
    expect(screen.queryByText("SupplyHouse")).toBeNull();

    fireEvent.change(search, { target: { value: "1038" } });
    expect(screen.getByText("Home Depot")).toBeTruthy();
    expect(screen.queryByText("Ferguson")).toBeNull();

    fireEvent.change(search, { target: { value: "kim service" } });
    expect(screen.getByText("Home Depot")).toBeTruthy();
  });

  it("updates the N of M count as the search narrows the rows", () => {
    render(<OrdersPanel />);
    fireEvent.change(screen.getByLabelText("Search purchase orders"), { target: { value: "ferguson" } });
    expect(screen.getByText("1 of 3")).toBeTruthy();
  });

  it("a no-match search falls through to a clear-filters row, not a blank table", () => {
    render(<OrdersPanel />);
    fireEvent.change(screen.getByLabelText("Search purchase orders"), { target: { value: "nobody buys here" } });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    fireEvent.click(screen.getByText("clear the filters"));
    expect(screen.getByText("Ferguson")).toBeTruthy();
  });
});

describe("OrdersPanel — per-row actions", () => {
  it("a DRAFT row gets an Order it button; ordered/cancelled rows get none", () => {
    render(<OrdersPanel />);
    const draftRow = screen.getByText("SupplyHouse").closest("tr")!;
    expect(within(draftRow).getByRole("button", { name: "Order it" })).toBeTruthy();

    const orderedRow = screen.getByText("Ferguson").closest("tr")!;
    expect(within(orderedRow).queryByRole("button")).toBeNull();
    const cancelledRow = screen.getByText("Home Depot").closest("tr")!;
    expect(within(cancelledRow).queryByRole("button")).toBeNull();
  });

  it("Order it places the draft directly, without opening the row", async () => {
    placeMutate.mockResolvedValue({ id: "po-2", status: "ordered", num: "PO-1044" });
    render(<OrdersPanel />);
    const draftRow = screen.getByText("SupplyHouse").closest("tr")!;
    fireEvent.click(within(draftRow).getByRole("button", { name: "Order it" }));

    expect(openModalMock).not.toHaveBeenCalled();
    await waitFor(() => expect(placeMutate).toHaveBeenCalledWith({ poId: "po-2" }));
    await waitFor(() => expect(adoptPurchaseOrder).toHaveBeenCalledWith({ id: "po-2", status: "ordered", num: "PO-1044" }));
  });

  it("a refused place shows the reason inline, without losing the row", async () => {
    // Shaped like a real tRPC client error for a domain validation refusal (BAD_REQUEST is in
    // userMessage's PASS_THROUGH set) — a bare Error would fall through to the generic fallback
    // instead of the server's own wording, which is not what production actually sends.
    placeMutate.mockRejectedValue({ message: "Add a line before placing the order.", data: { code: "BAD_REQUEST" } });
    render(<OrdersPanel />);
    const draftRow = screen.getByText("SupplyHouse").closest("tr")!;
    fireEvent.click(within(draftRow).getByRole("button", { name: "Order it" }));
    await waitFor(() => expect(screen.getByText("Add a line before placing the order.")).toBeTruthy());
    expect(screen.getByText("SupplyHouse")).toBeTruthy();
  });
});

describe("OrdersPanel — the other three list states", () => {
  it("first load in flight → loading, never a false empty", () => {
    mockPurchaseOrders = [];
    mockQuery = { ...mockQuery, isFetched: false };
    render(<OrdersPanel />);
    expect(screen.getByText("Loading purchase orders…")).toBeTruthy();
  });

  it("errored with nothing cached → LoadFailed with a retry", () => {
    mockPurchaseOrders = [];
    mockQuery = { ...mockQuery, isError: true };
    render(<OrdersPanel />);
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
  });

  it("loaded and genuinely empty → the first-run invitation, with a path into the create modal", () => {
    mockPurchaseOrders = [];
    render(<OrdersPanel />);
    expect(screen.getByText("No purchase orders yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ Draft an order" }));
    expect(openModalMock).toHaveBeenCalledWith("new-po");
  });

  it("an errored load with rows already cached shows the rows, not the error screen", () => {
    mockQuery = { ...mockQuery, isError: true };
    render(<OrdersPanel />);
    expect(screen.getByText("Ferguson")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });
});

describe("OrdersPanel — the phone layout's column labels", () => {
  it("labels every labeled cell and heads the stack with the vendor", () => {
    const { container } = render(<OrdersPanel />);
    const headers = Array.from(container.querySelectorAll("thead th")).map((th) => th.textContent);
    const row = container.querySelector("tbody tr")!;
    const labels = Array.from(row.querySelectorAll("td")).map((td) => td.getAttribute("data-label"));
    // The trailing action th/td pair carries no caption on either side — an action button needs
    // no "ACTIONS:" prefix on a phone any more than money-table.tsx's own action column does.
    expect(labels.slice(0, -1)).toEqual(headers.slice(0, -1));
    expect(labels[labels.length - 1]).toBeNull();
    expect(row.querySelector("td[data-primary]")!.textContent).toBe("Ferguson");
  });
});
