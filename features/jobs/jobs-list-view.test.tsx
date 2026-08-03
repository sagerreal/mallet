// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { mkJob, mkLead, mkTech, mkVisit } from "./test-factories";
import { dPlus } from "@/lib/prototype-sample";
import type { JobListItem } from "./server-rows";
import type { Job } from "@/lib/store/types";

// The view reads only leads + techs from the store; the rows come in as props.
const leads = [mkLead({ id: "l1", name: "Ann Alpha" }), mkLead({ id: "l2", name: "Zed Zulu" })];
const techs = [mkTech()];
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { leads: unknown; techs: unknown }) => unknown) => sel({ leads, techs }),
}));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { JobsListView } from "./jobs-list-view";
import { DEFAULT_JOB_COLS } from "./jobs-list-config";

const item = (job: Job, bandKey: JobListItem["bandKey"]): JobListItem => ({ job, bandKey });

const renderList = (items: JobListItem[], sort: { col: "when" | "amount" | "customer"; dir: "asc" | "desc" }) => {
  render(
    <JobsListView
      items={items}
      sort={sort}
      onSort={vi.fn()}
      onOpenJob={vi.fn()}
      visibleCols={[...DEFAULT_JOB_COLS]}
    />,
  );
  // The first cell of every row is the "Open <customer> · <job>" button.
  return screen
    .getAllByRole("button", { name: /^Open / })
    .map((b) => b.getAttribute("aria-label") ?? "");
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
    expect(order.map((l) => l.split(" · ")[1])).toEqual([
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
    expect(order.map((l) => l.split(" · ")[1])).toEqual([
      "Unscheduled drain",
      "Finished heater",
      "Next week valve",
      "Second finished",
    ]);
  });

  it("labels each row from its OWN band, not the first row's", () => {
    renderList(mixed, { col: "when", dir: "asc" });
    // needsSlot → "Needs a slot"; done → "Done"; later → "Scheduled". All three present means the
    // per-row band key survived the flattening.
    expect(screen.getByText("Needs a slot")).toBeTruthy();
    expect(screen.getAllByText("Done")).toHaveLength(2);
    expect(screen.getByText("Scheduled")).toBeTruthy();
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
    expect(renderList(rows, { col: "amount", dir: "desc" }).map((l) => l.split(" · ")[1])).toEqual([
      "Dear",
      "Middling",
      "Cheap",
    ]);
  });

  it("still sorts Customer on the client, because the server has no sort for it", () => {
    const rows = [priced("a", "l2", "Zed's job", 100), priced("b", "l1", "Ann's job", 100)];
    expect(renderList(rows, { col: "customer", dir: "asc" }).map((l) => l.split(" · ")[0])).toEqual([
      "Open Ann Alpha",
      "Open Zed Zulu",
    ]);
  });
});
