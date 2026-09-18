// @vitest-environment jsdom
/**
 * features/money/orders-hydrator.test.tsx
 * OrdersHydrator — the v1.purchasing.list → store.adoptPurchaseOrders wiring.
 *
 * Mocks the store and the tRPC client the same way field-toggles-hydrator.test.tsx does, so no
 * real Zustand instance or network/Supabase session is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { OrdersHydrator } from "./orders-hydrator";

const adoptPurchaseOrders = vi.fn();
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { adoptPurchaseOrders: typeof adoptPurchaseOrders }) => unknown) =>
    sel({ adoptPurchaseOrders }),
}));

const listQuery = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      purchasing: {
        list: { useQuery: () => listQuery() },
      },
    },
  },
}));

const dto = (overrides: Record<string, unknown> = {}) => ({
  id: "po-1",
  num: null,
  vendor: "Ferguson",
  status: "draft",
  jobId: null,
  jobTitle: null,
  orderedAt: null,
  expectedAt: null,
  shipToAddress: "412 Elm St, Unit 4",
  orderedByUserId: "user-1",
  orderedByName: "Dana",
  freight: { cents: 1_250, currency: "USD" },
  tax: { cents: 875, currency: "USD" },
  total: { cents: 95_270, currency: "USD" },
  lines: [
    {
      id: "line-1",
      description: "PEX fitting",
      qty: 10,
      uom: "ea",
      unitCostMillicents: 125_000,
      amount: { cents: 1_250, currency: "USD" },
    },
  ],
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

describe("OrdersHydrator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adopts the list into the store, converting money to dollars", () => {
    listQuery.mockReturnValue({ data: { items: [dto()] }, isError: false, error: null });
    render(<OrdersHydrator />);

    expect(adoptPurchaseOrders).toHaveBeenCalledTimes(1);
    const [orders] = adoptPurchaseOrders.mock.calls[0] as [Array<{ id: string; total: number; freight: number }>];
    expect(orders).toHaveLength(1);
    expect(orders[0]?.id).toBe("po-1");
    expect(orders[0]?.total).toBe(952.7);
    expect(orders[0]?.freight).toBe(12.5);
  });

  it("carries unitCostMillicents through unconverted", () => {
    listQuery.mockReturnValue({ data: { items: [dto()] }, isError: false, error: null });
    render(<OrdersHydrator />);
    const [orders] = adoptPurchaseOrders.mock.calls[0] as [Array<{ lines: Array<{ unitCostMillicents: number }> }>];
    expect(orders[0]?.lines[0]?.unitCostMillicents).toBe(125_000);
  });

  it("writes nothing while the read is in flight", () => {
    listQuery.mockReturnValue({ data: undefined, isError: false, error: null });
    render(<OrdersHydrator />);
    expect(adoptPurchaseOrders).not.toHaveBeenCalled();
  });

  it("writes nothing on a failed read", () => {
    listQuery.mockReturnValue({ data: undefined, isError: true, error: new Error("500") });
    expect(() => render(<OrdersHydrator />)).not.toThrow();
    expect(adoptPurchaseOrders).not.toHaveBeenCalled();
  });

  it("adopts an empty list without error", () => {
    listQuery.mockReturnValue({ data: { items: [] }, isError: false, error: null });
    render(<OrdersHydrator />);
    expect(adoptPurchaseOrders).toHaveBeenCalledWith([]);
  });
});
