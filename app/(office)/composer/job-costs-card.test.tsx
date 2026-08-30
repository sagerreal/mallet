// @vitest-environment jsdom
/**
 * app/(office)/composer/job-costs-card.test.tsx
 *
 * Other job costs, and the purchase orders the picker will offer.
 *
 * The rule under test is Owen's: a purchase order becomes a job cost when it is ADDED ON THE
 * JOB. So the picker offers the orders on THIS quote's job and nothing else — not a draft, not
 * another job's order, and not one that is already on the quote. Each of those, offered wrongly,
 * puts money on a margin that reads right and is not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const useQuery = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { purchasing: { list: { useQuery: (...args: unknown[]) => useQuery(...args) } } } },
}));

import { JobCostsCard } from "./job-costs-card";
import type { ComposerJobCost } from "./composer-state";

const JOB = "11111111-1111-4111-8111-111111111111";
const OTHER_JOB = "22222222-2222-4222-8222-222222222222";

const po = (over: Record<string, unknown> = {}) => ({
  id: "po-1",
  num: "PO-1042",
  vendor: "Sherwin-Williams",
  status: "ordered",
  jobId: JOB,
  total: { cents: 252_000, currency: "USD" as const },
  ...over,
});

const onChange = vi.fn();

beforeEach(() => {
  onChange.mockClear();
  useQuery.mockReset();
  useQuery.mockReturnValue({ data: { items: [po()] }, isPending: false });
  cleanup();
});

const card = (costs: ComposerJobCost[] = [], jobId: string | null = JOB) =>
  render(<JobCostsCard costs={costs} jobId={jobId} onChange={onChange} />);

const last = (): ComposerJobCost[] => onChange.mock.calls[onChange.mock.calls.length - 1]![0];

describe("JobCostsCard — costs the estimator types", () => {
  it("adds an empty row to write in", () => {
    card();
    fireEvent.click(screen.getByText("+ Add job cost"));
    expect(last()).toHaveLength(1);
    expect(last()[0]).toMatchObject({ d: "", amt: 0 });
  });

  it("totals what is on the list", () => {
    card([
      { id: "c1", d: "Dumpster", amt: 400 },
      { id: "c2", d: "Permit", amt: 210.5 },
    ]);
    expect(screen.getByText("$611")).toBeTruthy();
  });

  it("removes a row", () => {
    card([{ id: "c1", d: "Dumpster", amt: 400 }]);
    fireEvent.click(screen.getByLabelText("Remove job cost 1"));
    expect(last()).toEqual([]);
  });
});

describe("JobCostsCard — which orders the picker offers", () => {
  const openPicker = (costs: ComposerJobCost[] = [], jobId: string | null = JOB) => {
    card(costs, jobId);
    fireEvent.click(screen.getByText("Pull from purchase orders"));
  };

  it("offers an ordered PO on THIS job", () => {
    openPicker();
    expect(screen.getByText("Sherwin-Williams")).toBeTruthy();
    expect(screen.getByText("PO-1042")).toBeTruthy();
  });

  it("does not offer another job's order", () => {
    useQuery.mockReturnValue({ data: { items: [po({ jobId: OTHER_JOB })] }, isPending: false });
    openPicker();
    expect(screen.getByText(/no orders placed on this job/i)).toBeTruthy();
  });

  it("does not offer an order with no job at all — that is not a job cost", () => {
    useQuery.mockReturnValue({ data: { items: [po({ jobId: null })] }, isPending: false });
    openPicker();
    expect(screen.getByText(/no orders placed on this job/i)).toBeTruthy();
  });

  it("does not offer a draft — the vendor has not heard of it yet", () => {
    useQuery.mockReturnValue({ data: { items: [po({ status: "draft" })] }, isPending: false });
    openPicker();
    expect(screen.getByText(/no orders placed on this job/i)).toBeTruthy();
  });

  it("does not offer a cancelled one", () => {
    useQuery.mockReturnValue({ data: { items: [po({ status: "cancelled" })] }, isPending: false });
    openPicker();
    expect(screen.getByText(/no orders placed on this job/i)).toBeTruthy();
  });

  it("says the quote has no job rather than listing someone else's spending", () => {
    openPicker([], null);
    expect(screen.getByText(/no job behind it yet/i)).toBeTruthy();
  });

  it("does not even ask for the orders until the picker is opened", () => {
    card();
    expect(useQuery).toHaveBeenLastCalledWith(undefined, expect.objectContaining({ enabled: false }));
  });
});

describe("JobCostsCard — pulling one", () => {
  it("snapshots the order's total onto the quote, tagged with its number", () => {
    card();
    fireEvent.click(screen.getByText("Pull from purchase orders"));
    fireEvent.click(screen.getByText("Sherwin-Williams"));
    expect(last()[0]).toMatchObject({
      d: "Sherwin-Williams",
      amt: 2520,
      poId: "po-1",
      poNum: "PO-1042",
    });
  });

  it("refuses to offer an order that is already on the quote", () => {
    // The office looking at a list has no way to remember which ones they took, and a doubled
    // $2,520 order is a margin that reads right and is not.
    card([{ id: "c1", d: "Sherwin-Williams", amt: 2520, poId: "po-1", poNum: "PO-1042" }]);
    fireEvent.click(screen.getByText("Pull from purchase orders"));
    expect(screen.getByText("Added")).toBeTruthy();
    // The pick BUTTON, not the row's remove control — both name the vendor.
    expect((screen.getByText("Added").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a pulled cost as its order, not as an editable row", () => {
    // Its amount is the order's, frozen when it was pulled. Typing over it would be a number
    // that claims to come from PO-1042 and does not.
    card([{ id: "c1", d: "Sherwin-Williams", amt: 2520, poId: "po-1", poNum: "PO-1042" }]);
    expect(screen.queryByLabelText("What the cost is, job cost 1")).toBeNull();
    expect(screen.getByText("PO-1042")).toBeTruthy();
  });
});
