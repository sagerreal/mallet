// @vitest-environment jsdom
/**
 * components/modals/price-builder-modal.test.tsx
 * The office Build-the-price sheet — the one-job-type model's commitment point.
 * What matters: saving BOOKS the price in ONE store call (lines + rates + book,
 * atomic on the server — review caught the stranded state a second round-trip
 * left), failure keeps the sheet open, the pricing rows are Discount/Sales-tax
 * only (no Deposit — jobs store no deposit rate), and stored rates seed the rows
 * so reopening shows the price as saved.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PriceBuilderModalContent } from "./price-builder-modal";
import type { Job } from "@/lib/store/types";

const setJobLines = vi.fn();
let closeMock = vi.fn();
let mockJobs: Job[] = [];

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ params: { jobId: "job-1" } }),
  useCloseModal: () => closeMock,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      jobs: mockJobs,
      leads: [{ id: "lead-1", name: "Dana Alvarez" }],
      setJobLines,
      services: [],
      laborRates: [],
      updateJob: vi.fn(),
      taxRate: 0,
    }),
}));

const makeJob = (over: Partial<Job> = {}): Job =>
  ({
    id: "job-1",
    leadId: "lead-1",
    kind: "estimate",
    svc: "",
    origin: "db",
    title: "Water heater swap",
    addr: "",
    phone: "",
    status: "unscheduled",
    archived: false,
    lines: [],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [],
    ...over,
  }) as unknown as Job;

beforeEach(() => {
  setJobLines.mockReset();
  setJobLines.mockResolvedValue({ ok: true });
  closeMock = vi.fn();
  mockJobs = [makeJob()];
});

/** Add one custom line at $500 through the picker (empty job opens picking). */
function priceFiveHundred() {
  fireEvent.click(screen.getByText("Custom item"));
  fireEvent.change(screen.getByLabelText("Price"), { target: { value: "500" } });
  fireEvent.change(screen.getByPlaceholderText(/part, material/), {
    target: { value: "Water heater swap" },
  });
}

describe("PriceBuilderModalContent — saving books the price", () => {
  it("ONE store call carrying lines, rates and book: true — never a second round-trip", async () => {
    render(<PriceBuilderModalContent />);
    priceFiveHundred();
    fireEvent.click(screen.getByRole("button", { name: "Save price →" }));

    await waitFor(() => expect(closeMock).toHaveBeenCalled());
    expect(setJobLines).toHaveBeenCalledTimes(1);
    const [jobId, jobLines, opts] = setJobLines.mock.calls[0] as [
      string,
      { d: string; r: number }[],
      { discBps: number; taxBps: number; book?: boolean },
    ];
    expect(jobId).toBe("job-1");
    expect(jobLines).toEqual([expect.objectContaining({ d: "Water heater swap", r: 500 })]);
    expect(opts).toEqual({ discBps: 0, taxBps: 0, book: true });
  });

  it("a refused save keeps the sheet open with the error — no silent close", async () => {
    setJobLines.mockResolvedValue({ ok: false });
    render(<PriceBuilderModalContent />);
    priceFiveHundred();
    fireEvent.click(screen.getByRole("button", { name: "Save price →" }));

    await waitFor(() =>
      expect(screen.getByText(/couldn't save the price/i)).toBeTruthy(),
    );
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("double-click saves ONCE — the ref guard is synchronous", async () => {
    let release!: (v: { ok: boolean }) => void;
    setJobLines.mockReturnValue(new Promise((res) => { release = res; }));
    render(<PriceBuilderModalContent />);
    priceFiveHundred();
    const save = screen.getByRole("button", { name: "Save price →" });
    fireEvent.click(save);
    fireEvent.click(save);

    release({ ok: true });
    await waitFor(() => expect(closeMock).toHaveBeenCalled());
    expect(setJobLines).toHaveBeenCalledTimes(1);
  });
});

describe("PriceBuilderModalContent — the pricing rows", () => {
  it("offers Discount and Sales tax once a line is priced — and never a Deposit row", () => {
    render(<PriceBuilderModalContent />);
    priceFiveHundred();
    expect(screen.getByRole("button", { name: /^Discount/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Sales tax/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Deposit/ })).toBeNull();
  });

  it("seeds the rows from the job's STORED rates — reopening shows the price as saved", () => {
    mockJobs = [
      makeJob({
        kind: "work",
        lines: [{ d: "Water heater swap", q: 1, r: 500 }],
        pricing: { disc: 10, tax: 8.75 },
      } as Partial<Job>),
    ];
    render(<PriceBuilderModalContent />);
    // The rows' collapsed values state the derivation of the stored rates.
    expect(screen.getByRole("button", { name: /^Discount/ }).textContent).toContain("−$50.00");
    expect(screen.getByRole("button", { name: /^Sales tax/ }).textContent).toContain("8.75");
  });

  it("saves the rates it shows — bps derived from the same lines", async () => {
    mockJobs = [
      makeJob({
        kind: "work",
        lines: [{ d: "Water heater swap", q: 1, r: 500 }],
        pricing: { disc: 10, tax: 8.75 },
      } as Partial<Job>),
    ];
    render(<PriceBuilderModalContent />);
    fireEvent.click(screen.getByRole("button", { name: "Save price →" }));
    await waitFor(() => expect(setJobLines).toHaveBeenCalledTimes(1));
    const [, , opts] = setJobLines.mock.calls[0] as [unknown, unknown, { discBps: number; taxBps: number }];
    expect(opts).toMatchObject({ discBps: 1_000, taxBps: 875 });
  });
});
