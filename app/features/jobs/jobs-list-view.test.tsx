// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { mkJob, mkLead, mkTech, mkVisit } from "./test-factories";
import { dPlus } from "@/lib/prototype-sample";
import type { JobListItem } from "./server-rows";
import type { Job } from "@/lib/store/types";

// The view reads only leads + techs from the store; the rows come in as props.
const leads = [mkLead({ id: "l1", name: "Ann Alpha", address: "1147 Alder Ave" }), mkLead({ id: "l2", name: "Zed Zulu" })];
const techs = [mkTech()];
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { leads: unknown; techs: unknown }) => unknown) => sel({ leads, techs }),
}));
// A real anchor, not a passthrough: the needs-a-slot WHEN cell IS a link, and the thing worth
// testing about it is that clicking it does not also open the row.
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { JobsListView } from "./jobs-list-view";

const item = (job: Job, bandKey: JobListItem["bandKey"]): JobListItem => ({ job, bandKey });

const renderList = (
  items: JobListItem[],
  sort: { col: "when" | "amount" | "customer"; dir: "asc" | "desc" },
  onOpenJob: (id: string) => void = vi.fn(),
) => {
  render(<JobsListView items={items} sort={sort} onSort={vi.fn()} onOpenJob={onOpenJob} />);
  // The first cell of every row is the "Open <job> · <customer>" button — job first, matching the
  // order the cell renders. Returned with the verb stripped, so [0] is the job and [1] the customer.
  return screen
    .getAllByRole("button", { name: /^Open / })
    .map((b) => (b.getAttribute("aria-label") ?? "").replace(/^Open /, ""));
};

describe("JobsListView — the server owns the WHEN order", () => {
  const mixed: JobListItem[] = [
    item(mkJob({ id: "a", title: "Unscheduled drain", leadId: "l1", status: "unscheduled" }), "needsSlot"),
    item(mkJob({ id: "b", title: "Finished heater", leadId: "l2", status: "done", visits: [mkVisit({ date: dPlus(-3), techId: "1", start: 9, status: "done" })] }), "done"),
    item(mkJob({ id: "c", title: "Next week valve", leadId: "l1", visits: [mkVisit({ date: dPlus(5), techId: "1", start: 10 })] }), "later"),
    item(mkJob({ id: "d", title: "Second finished", leadId: "l2", status: "done", visits: [mkVisit({ date: dPlus(-2), techId: "1", start: 9, status: "done" })] }), "done"),
  ];

  it("renders the page in the order it was handed, ascending", () => {
    const order = renderList(mixed, { col: "when", dir: "asc" });
    expect(order.map((l) => l.split(" · ")[0])).toEqual([
      "Unscheduled drain",
      "Finished heater",
      "Next week valve",
      "Second finished",
    ]);
  });

  it("does NOT reverse the page when the WHEN sort is descending", () => {
    // The deleted bug: the client re-sorted by row POSITION and flipped on direction, so a
    // descending page from the server was rendered ascending. The server pages in the direction
    // the header asks for; the client must render what arrived.
    const order = renderList(mixed, { col: "when", dir: "desc" });
    expect(order.map((l) => l.split(" · ")[0])).toEqual([
      "Unscheduled drain",
      "Finished heater",
      "Next week valve",
      "Second finished",
    ]);
  });

  it("labels each row from its OWN band, not the first row's", () => {
    renderList(mixed, { col: "when", dir: "asc" });
    // The band now reads out of the WHEN cell: "sold ..." for needsSlot, "done ..." twice, and a
    // plain date for the scheduled one. All present means the per-row band key survived the
    // flattening — the thing the Status pill used to prove.
    expect(screen.getByText(/^sold /)).toBeTruthy();
    expect(screen.getAllByText(/^done /)).toHaveLength(2);
  });

  it("shows an unscheduled row's 'sold' text and a scheduled row's date, in one flat table", () => {
    renderList(mixed, { col: "when", dir: "asc" });
    expect(screen.getByText(/^sold /)).toBeTruthy();
    expect(screen.getAllByText(/^done /)).toHaveLength(2);
  });
});

describe("JobsListView — the columns the server does not order", () => {
  const priced = (id: string, leadId: string, title: string, rate: number): JobListItem =>
    item(
      mkJob({ id, leadId, title, lines: [{ id: `${id}-l`, d: "Work", q: 1, r: rate, c: 0 }] as never }),
      "later",
    );

  it("still sorts Amount on the client, so the order agrees with the numbers shown", () => {
    // The Amount column prints jobTotal() — the sum of the job's LINES — while the server pages on
    // jobs.total_cents. Re-sorting keeps the visible order agreeing with the visible figures.
    const rows = [priced("a", "l1", "Cheap", 100), priced("b", "l2", "Dear", 900), priced("c", "l1", "Middling", 500)];
    expect(renderList(rows, { col: "amount", dir: "desc" }).map((l) => l.split(" · ")[0])).toEqual([
      "Dear",
      "Middling",
      "Cheap",
    ]);
  });

  it("still sorts Customer on the client, because the server has no sort for it", () => {
    const rows = [priced("a", "l2", "Zed's job", 100), priced("b", "l1", "Ann's job", 100)];
    expect(renderList(rows, { col: "customer", dir: "asc" }).map((l) => l.split(" · ")[1])).toEqual([
      "Ann Alpha",
      "Zed Zulu",
    ]);
  });
});

describe("JobsListView — the columns themselves", () => {
  const slotRow: JobListItem[] = [
    item(mkJob({ id: "a", title: "Sewer repair", leadId: "l1", status: "unscheduled", addr: "418 Cedar St" }), "needsSlot"),
  ];

  it("has no Status column — it printed the selected chip's own word on every row", () => {
    renderList(slotRow, { col: "when", dir: "asc" });
    expect(screen.queryByRole("columnheader", { name: /status/i })).toBeNull();
  });

  it("shows the job's address, which is the one fact that differs on every row", () => {
    renderList(slotRow, { col: "when", dir: "asc" });
    expect(screen.getByRole("columnheader", { name: /address/i })).toBeTruthy();
    expect(screen.getByText("418 Cedar St")).toBeTruthy();
  });

  it("falls back to the CUSTOMER's address, which is where 98% of rows get one", () => {
    // The store lead "l1" is Ann Alpha; give her an address and leave the job's own blank.
    const noOwnAddr: JobListItem[] = [
      item(mkJob({ id: "c", title: "Drain clearing", leadId: "l1", status: "unscheduled", addr: "" }), "needsSlot"),
    ];
    renderList(noOwnAddr, { col: "when", dir: "asc" });
    expect(screen.getByText("1147 Alder Ave")).toBeTruthy();
  });

  it("sends a needs-a-slot row's WHEN cell to the board WITHOUT opening the job", () => {
    // The cell is the only control on the row that goes somewhere else. Without stopPropagation it
    // would open the modal too, and the board would never be reached.
    const onOpenJob = vi.fn();
    renderList(slotRow, { col: "when", dir: "asc" }, onOpenJob);
    const link = screen.getByRole("link", { name: /sold/i });
    expect(link.getAttribute("href")).toBe("/jobs?tab=schedule");
    fireEvent.click(link);
    expect(onOpenJob).not.toHaveBeenCalled();
  });

  it("marks an overdue row late, and does not link it anywhere", () => {
    const late: JobListItem[] = [
      item(mkJob({ id: "b", title: "Slab leak", leadId: "l1", visits: [mkVisit({ date: dPlus(-3), techId: "1", start: 9 })] }), "late"),
    ];
    renderList(late, { col: "when", dir: "asc" });
    expect(screen.getByText(/3d late/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /late/i })).toBeNull();
  });
});
