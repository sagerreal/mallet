// @vitest-environment jsdom
/**
 * features/board/work-board.test.tsx
 * THE BOARD AS A SHAPE: four columns, always, with the work that needs the shop pinned to the top
 * of each one under a label that says so. The grouping is what makes the board readable at a
 * glance — a column that mixed "needs quote" into "waiting on the customer" would be a list, not
 * a board — so it is asserted as ORDER, not just as presence.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkBoard, WorkBoardSkeleton, boardGroups } from "./work-board";
import type { BoardColumn, BoardItem, WorkBoardData } from "./types";

vi.mock("@/features/home/send", () => ({
  clockNow: () => "8:47pm",
  commitOkSend: () => () => {},
  dispatchOkSend: vi.fn(() => Promise.resolve()),
  okSendKey: (item: { key: string }) => `${item.key}-fu1`,
}));

vi.mock("@/lib/store/app-store", () => {
  const state = {
    dismissAttention: vi.fn(),
    undismissAttention: vi.fn(),
    a2pStatus: { status: "active", canText: true, needsInput: false, failureReason: null },
  };
  const useAppStore = Object.assign((sel: (s: typeof state) => unknown) => sel(state), {
    getState: () => state,
  });
  return { useAppStore, useOpenModal: () => vi.fn() };
});

// ---- fixtures ---------------------------------------------------------------

const card = (over: Partial<BoardItem> = {}): BoardItem => ({
  key: "be-e1", kind: "estimate", column: "quoting", refId: "e1", leadId: "l1",
  name: "Maria Ortiz", service: "Water heater replacement", valueDollars: 2890,
  stateLabel: "Awaiting customer", tone: "waiting", needsAction: false, ageLabel: "Quiet 3 days",
  ...over,
});

const column = (over: Partial<BoardColumn> & Pick<BoardColumn, "id" | "title">): BoardColumn => ({
  items: [], count: 0, valueDollars: 0, truncated: false, ...over,
});

const fixtureBoard: WorkBoardData = {
  columns: [
    column({
      id: "requests", title: "New requests", count: 1, valueDollars: 400,
      items: [card({ key: "bl-l9", kind: "lead", column: "requests", name: "Ed Nunez", stateLabel: "Needs response", tone: "attention", needsAction: true, valueDollars: 400 })],
    }),
    column({
      id: "quoting", title: "Estimates & quotes", count: 2, valueDollars: 5780,
      items: [
        card({ key: "be-e2", stateLabel: "Needs quote", tone: "attention", needsAction: true, name: "Ana Diaz" }),
        card({ key: "be-e1" }),
      ],
    }),
    column({
      id: "jobs", title: "Jobs", count: 2, valueDollars: 3000, truncated: true,
      items: [
        card({ key: "bj-j1", kind: "job", column: "jobs", name: "Dana Fox", stateLabel: "On site", tone: "active", needsAction: false }),
        card({ key: "bj-j2", kind: "job", column: "jobs", name: "Sam Reed", stateLabel: "Scheduled", tone: "waiting", needsAction: false }),
      ],
    }),
    column({
      id: "billing", title: "Billing", count: 1, valueDollars: 1325,
      items: [card({ key: "bi-i1", kind: "invoice", column: "billing", name: "Ivy Poe", stateLabel: "Awaiting payment", tone: "waiting", needsAction: false })],
    }),
  ],
  needsYou: { count: 2, valueDollars: 3290, textsReady: 0 },
  isFetched: true,
  isError: false,
};

const labelsIn = (region: HTMLElement): string[] =>
  Array.from(region.querySelectorAll(".kgrp")).map((el) => el.textContent ?? "");

// ---- the tests --------------------------------------------------------------

describe("WorkBoard", () => {
  it("renders four columns with needs-action groups pinned first", () => {
    render(<WorkBoard data={fixtureBoard} firstRun={false} onOpen={vi.fn()} />);

    expect(screen.getAllByRole("region", { name: /column/i })).toHaveLength(4);
    const labels = screen.getAllByText(/needs action/i);
    expect(labels.length).toBeGreaterThan(0);

    const quoting = screen.getByRole("region", { name: /estimates & quotes column/i });
    expect(labelsIn(quoting)[0]).toMatch(/needs action/i);
  });

  it("labels the passive group in each column's own words", () => {
    render(<WorkBoard data={fixtureBoard} firstRun={false} onOpen={vi.fn()} />);

    expect(labelsIn(screen.getByRole("region", { name: /estimates & quotes column/i })).join(" "))
      .toMatch(/waiting for customer/i);
    expect(labelsIn(screen.getByRole("region", { name: /^jobs column$/i })).join(" "))
      .toMatch(/scheduled \/ in field/i);
    expect(labelsIn(screen.getByRole("region", { name: /billing column/i })).join(" "))
      .toMatch(/awaiting payment/i);
  });

  it("states what the column holds — the count and the money", () => {
    render(<WorkBoard data={fixtureBoard} firstRun={false} onOpen={vi.fn()} />);
    const quoting = screen.getByRole("region", { name: /estimates & quotes column/i });
    expect(quoting.querySelector(".sum")?.textContent).toBe("2 · $5,780");
  });

  it("says a truncated column is a page, as a fact and not an apology", () => {
    render(<WorkBoard data={fixtureBoard} firstRun={false} onOpen={vi.fn()} />);
    expect(screen.getByText("Showing first 2")).toBeTruthy();
    // The columns that fit say nothing at all.
    expect(screen.queryByText("Showing first 1")).toBeNull();
  });

  it("renders a card per item", () => {
    const { container } = render(<WorkBoard data={fixtureBoard} firstRun={false} onOpen={vi.fn()} />);
    expect(container.querySelectorAll(".kcard")).toHaveLength(6);
  });

  it("hands the whole item back when a card is opened", async () => {
    const onOpen = vi.fn();
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<WorkBoard data={fixtureBoard} firstRun={false} onOpen={onOpen} />);

    await user.click(screen.getByRole("button", { name: "Dana Fox" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: "bj-j1" }));
  });

  it("defers the first-run board to the setup brief that owns it", () => {
    const { container } = render(<WorkBoard data={fixtureBoard} firstRun onOpen={vi.fn()} />);
    expect(container.querySelector(".board")).toBeNull();
  });
});

describe("boardGroups", () => {
  it("orders the groups: what the shop owes, then the crew in the field, then the wait", () => {
    const groups = boardGroups(
      column({
        id: "jobs", title: "Jobs",
        items: [
          card({ key: "a", column: "jobs", tone: "waiting", needsAction: false }),
          card({ key: "b", column: "jobs", tone: "active", needsAction: false }),
          card({ key: "c", column: "jobs", tone: "attention", needsAction: true }),
        ],
      }),
    );
    expect(groups.map((g) => g.label)).toEqual([
      "Needs action",
      "Scheduled / in field",
      "Scheduled / waiting",
    ]);
    expect(groups[0]?.attention).toBe(true);
  });

  it("emits no group for a shape the column doesn't hold", () => {
    const groups = boardGroups(
      column({ id: "billing", title: "Billing", items: [card({ column: "billing" })] }),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Awaiting payment");
  });

  it("keeps the ranked order inside a group", () => {
    const groups = boardGroups(
      column({
        id: "quoting", title: "Estimates & quotes",
        items: [card({ key: "x", name: "Zed" }), card({ key: "y", name: "Abe" })],
      }),
    );
    expect(groups[0]?.items.map((i) => i.key)).toEqual(["x", "y"]);
  });

  it("has nothing to say about an empty column", () => {
    expect(boardGroups(column({ id: "requests", title: "New requests" }))).toEqual([]);
  });
});

describe("WorkBoardSkeleton", () => {
  it("announces itself as busy and draws the board's shape", () => {
    const { container } = render(<WorkBoardSkeleton />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(container.querySelectorAll(".col")).toHaveLength(4);
  });
});
