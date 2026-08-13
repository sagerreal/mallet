// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const openModal = vi.fn();
const closeModal = vi.fn();
vi.mock("@/lib/store/app-store", () => ({
  useOpenModal: () => openModal,
  useCloseModal: () => closeModal,
}));

let trail: unknown;
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { links: { forRecord: { useQuery: () => ({ data: trail }) } } } },
}));

import { Trail } from "./trail";

const CUSTOMER = { id: "lead-1", name: "Ed Okafor" };
const QUOTE = { id: "est-1", num: "EST-1044", status: "accepted" };
const JOB = { id: "job-1", title: "Drain clearing — kitchen", status: "scheduled", completedAt: null };
const INVOICE = { id: "inv-1", num: "INV-1042", status: "sent", totalCents: 68500, owedCents: 68500, dueAt: null };

const data = (over: Record<string, unknown> = {}) => ({
  customer: CUSTOMER,
  quotes: [] as unknown[],
  jobs: [] as unknown[],
  invoices: [] as unknown[],
  counts: { quotes: 0, jobs: 0, invoices: 0 },
  cap: 6,
  ...over,
});

/** Label text with the count stripped, in chain order. */
const labels = () =>
  Array.from(document.querySelectorAll(".trail .hop, .trail .here, .trail .none")).map((e) =>
    (e.textContent ?? "").trim(),
  );

beforeEach(() => {
  trail = undefined;
  vi.clearAllMocks();
});

describe("Trail", () => {
  it("renders nothing until the read lands — a chain that fills in reads as a glitch", () => {
    render(<Trail kind="job" id="job-1" />);
    expect(document.querySelector(".trail")).toBeNull();
  });

  it("always shows four positions in chain order, whatever exists", () => {
    trail = data({ quotes: [QUOTE], jobs: [JOB], counts: { quotes: 1, jobs: 1, invoices: 0 } });
    render(<Trail kind="job" id="job-1" />);
    expect(labels()).toEqual(["Ed Okafor", "Quote", "Job", "no invoice"]);
  });

  it("marks where you are as plain ink, not a link — it goes nowhere", () => {
    trail = data({ quotes: [QUOTE], jobs: [JOB], counts: { quotes: 1, jobs: 1, invoices: 0 } });
    render(<Trail kind="job" id="job-1" />);
    const here = document.querySelector(".trail .here");
    expect(here?.textContent).toBe("Job");
    expect(here?.tagName).not.toBe("BUTTON");
    expect(screen.queryByRole("button", { name: "Job" })).toBeNull();
  });

  it("states an absence as words, never a dash", () => {
    trail = data({ jobs: [JOB], counts: { quotes: 0, jobs: 1, invoices: 0 } });
    render(<Trail kind="job" id="job-1" />);
    expect(screen.getByText("no quote")).toBeTruthy();
    expect(screen.getByText("no invoice")).toBeTruthy();
    // And an absence is NOT a control: there is nothing to navigate to.
    expect(screen.queryByRole("button", { name: "no quote" })).toBeNull();
  });

  it("goes straight there when exactly one is attached", () => {
    trail = data({ quotes: [QUOTE], jobs: [JOB], counts: { quotes: 1, jobs: 1, invoices: 0 } });
    render(<Trail kind="job" id="job-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Quote" }));
    expect(closeModal).toHaveBeenCalled();
    expect(openModal).toHaveBeenCalledWith("est", { estId: "est-1" });
  });

  it("links the customer by NAME, and by id — not by whatever the store happens to hold", () => {
    trail = data({ jobs: [JOB], counts: { quotes: 0, jobs: 1, invoices: 0 } });
    render(<Trail kind="job" id="job-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Ed Okafor" }));
    expect(openModal).toHaveBeenCalledWith("lead", { leadId: "lead-1" });
  });

  it("carries the count when several are attached, so you know before you tap", () => {
    trail = data({
      jobs: [JOB, { ...JOB, id: "job-2", title: "Hose bib" }, { ...JOB, id: "job-3", title: "Flush" }],
      counts: { quotes: 0, jobs: 3, invoices: 0 },
    });
    render(<Trail kind="customer" id="lead-1" />);
    expect(screen.getByRole("button", { name: "3 jobs" })).toBeTruthy();
  });

  it("opens a chooser IN FLOW when several are attached, and picks one", () => {
    trail = data({
      jobs: [JOB, { ...JOB, id: "job-2", title: "Hose bib replacement" }],
      counts: { quotes: 0, jobs: 2, invoices: 0 },
    });
    render(<Trail kind="customer" id="lead-1" />);
    expect(document.querySelector(".trail-pick")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "2 jobs" }));
    const pick = document.querySelector(".trail-pick");
    expect(pick).toBeTruthy();
    // A sibling of the trail, not a portal — the house rule forbids floating panels.
    expect(pick?.parentElement?.tagName).not.toBe("BODY");

    fireEvent.click(screen.getByText("Hose bib replacement"));
    expect(openModal).toHaveBeenCalledWith("job", { jobId: "job-2" });
  });

  it("closes the chooser when the same hop is tapped again", () => {
    trail = data({ jobs: [JOB, { ...JOB, id: "job-2" }], counts: { quotes: 0, jobs: 2, invoices: 0 } });
    render(<Trail kind="customer" id="lead-1" />);
    const hop = screen.getByRole("button", { name: "2 jobs" });
    fireEvent.click(hop);
    expect(document.querySelector(".trail-pick")).toBeTruthy();
    fireEvent.click(hop);
    expect(document.querySelector(".trail-pick")).toBeNull();
  });

  it("says the chooser is a truncation when the count exceeds the rows", () => {
    // The list is a chooser, not a list view. Six rows over forty must not imply forty.
    trail = data({
      jobs: Array.from({ length: 6 }, (_, i) => ({ ...JOB, id: `job-${i}`, title: `Job ${i}` })),
      counts: { quotes: 0, jobs: 40, invoices: 0 },
    });
    render(<Trail kind="customer" id="lead-1" />);
    fireEvent.click(screen.getByRole("button", { name: "40 jobs" }));
    expect(screen.getByText(/6 of 40/)).toBeTruthy();
  });

  it("tells invoices apart by what is still owed", () => {
    trail = data({
      invoices: [INVOICE, { ...INVOICE, id: "inv-2", num: "INV-1039", owedCents: 0 }],
      counts: { quotes: 0, jobs: 0, invoices: 2 },
    });
    render(<Trail kind="customer" id="lead-1" />);
    fireEvent.click(screen.getByRole("button", { name: "2 invoices" }));
    expect(screen.getByText("$685 owed")).toBeTruthy();
    expect(screen.getByText("paid")).toBeTruthy();
  });

  it("says so when there is no customer at all rather than rendering a gap", () => {
    trail = data({ customer: null });
    render(<Trail kind="job" id="job-1" />);
    expect(screen.getByText("no customer")).toBeTruthy();
  });
});
