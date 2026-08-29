// @vitest-environment jsdom
/**
 * features/money/orders-panel.test.tsx
 * The Orders tab list: the four list states, the status chips, the row cells, and the
 * Placed/In draft footer — ported from the approved mock (mock/money-purchase-orders,
 * app/(office)/money/po/page.tsx) against the real store.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { purchaseOrders: PurchaseOrder[] }) => unknown) =>
    sel({ purchaseOrders: mockPurchaseOrders }),
  useOpenModal: () => openModalMock,
}));
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { purchasing: { list: { useQuery: () => mockQuery } } } },
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
  shipTo: "job_site",
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

describe("OrdersPanel — populated", () => {
  it("renders the list columns in order and the row values", () => {
    render(<OrdersPanel />);
    const headers = Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).toEqual(["#", "Vendor", "For job", "Status", "Total", "Ordered"]);

    expect(screen.getByText("PO-1043")).toBeTruthy();
    expect(screen.getByText("Ferguson")).toBeTruthy();
    expect(screen.getByText("Henderson repipe")).toBeTruthy();
    // Scoped to the row — the same figure also lands in the footer's "Placed" total below.
    const row = screen.getByText("PO-1043").closest("tr")!;
    expect(within(row).getByText("$952.70")).toBeTruthy();
    expect(within(row).getByText("2026-08-19")).toBeTruthy();
  });

  it("a draft with no number and no job reads — and stock, not blank", () => {
    render(<OrdersPanel />);
    expect(screen.getByText("stock")).toBeTruthy();
    // The draft row's # cell and Ordered cell both fall back to the em dash.
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

  it("the header's + New purchase order button opens the create modal", () => {
    render(<OrdersPanel />);
    fireEvent.click(screen.getByRole("button", { name: "+ New purchase order" }));
    expect(openModalMock).toHaveBeenCalledWith("new-po");
  });

  it("clicking a row opens that order's record sheet", () => {
    render(<OrdersPanel />);
    fireEvent.click(screen.getByText("Ferguson").closest("tr")!);
    expect(openModalMock).toHaveBeenCalledWith("po", { poId: "po-1" });
  });

  it("the footer totals PLACED orders in red and DRAFT orders plainly, over the whole book", () => {
    const { container } = render(<OrdersPanel />);
    // Placed = the one "ordered" PO ($952.70); In draft = the one "draft" PO ($2,140.00).
    // Cancelled never counts toward either figure. `.muted b` is unique to the footer — no row
    // cell carries both classes, so this can't collide with the Total column's own figures.
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
    // Still shows both figures, unaffected by the Cancelled filter narrowing the visible rows.
    const footerAmounts = Array.from(container.querySelectorAll(".muted b")).map((b) => b.textContent);
    expect(footerAmounts).toEqual(["$952.70", "$2,140.00"]);
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
  it("labels every cell and heads the stack with the vendor", () => {
    const { container } = render(<OrdersPanel />);
    const headers = Array.from(container.querySelectorAll("thead th")).map((th) => th.textContent);
    const row = container.querySelector("tbody tr")!;
    const labels = Array.from(row.querySelectorAll("td")).map((td) => td.getAttribute("data-label"));
    expect(labels).toEqual(headers);
    expect(row.querySelector("td[data-primary]")!.textContent).toBe("Ferguson");
  });
});
