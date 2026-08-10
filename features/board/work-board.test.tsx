// @vitest-environment jsdom
/**
 * features/board/work-board.test.tsx
 * THE BOARD AS A SHAPE: four columns, always, with the work that needs the shop pinned to the top
 * of each one under a label that says so. The grouping is what makes the board readable at a
 * glance — a column that mixed "needs quote" into "waiting on the customer" would be a list, not
 * a board — so it is asserted as ORDER, not just as presence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { WorkBoard, WorkBoardSkeleton, boardGroups } from "./work-board";
import { UNDO_WINDOW_MS } from "./use-board-sends";
import { GHOST_CARDS } from "./ghosts";
import type { BoardColumn, BoardColumnId, BoardItem, WorkBoardData } from "./types";
import type { OkItem } from "@/features/home/derive";
import type { Estimate, Lead } from "@/lib/store/types";

const spies = vi.hoisted(() => ({
  dispatch: vi.fn(() => Promise.resolve()),
  undo: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("@/features/home/send", () => ({
  clockNow: () => "8:47pm",
  commitOkSend: () => spies.undo,
  dispatchOkSend: spies.dispatch,
  okSendKey: (item: { key: string }) => `${item.key}-d20260807`,
}));

vi.mock("@/lib/store/app-store", () => {
  const state = {
    dismissAttention: spies.dismiss,
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
  wonCount: 0,
  isFetched: true,
  isError: false,
};

/** A brand-new shop: every source read, nothing open, nothing wrong. */
const emptyBoard: WorkBoardData = {
  columns: [
    column({ id: "requests", title: "New requests" }),
    column({ id: "quoting", title: "Estimates & quotes" }),
    column({ id: "jobs", title: "Jobs" }),
    column({ id: "billing", title: "Billing" }),
  ],
  needsYou: { count: 0, valueDollars: 0, textsReady: 0 },
  wonCount: 0,
  isFetched: true,
  isError: false,
};

const labelsIn = (region: HTMLElement): string[] =>
  Array.from(region.querySelectorAll(".kgrp")).map((el) => el.textContent ?? "");

/** A quote card carrying a prepared reminder — exactly what useOkQueue hands the board. */
const okLead: Lead = {
  id: "11111111-1111-4111-8111-111111111111", name: "Maria Ortiz", phone: "555-0100",
  source: "web", stage: "Quote Sent", age: 3, job: "Water heater leaking", last: "",
};
const ok: OkItem = {
  key: "okq-e1", kind: "quote-viewed", lead: okLead,
  estimate: { id: "e1", num: "EST-1001", cachedTotal: 2890, lines: [] } as unknown as Estimate,
  value: 2890, situation: "read the $2,890 quote", editLabel: "Change",
};

const boardWithDraft: WorkBoardData = {
  ...fixtureBoard,
  columns: [
    fixtureBoard.columns[0],
    column({
      id: "quoting", title: "Estimates & quotes", count: 1, valueDollars: 2890,
      items: [card({ key: "be-e1", stateLabel: "Reminder due", tone: "attention", needsAction: true, ok })],
    }),
    fixtureBoard.columns[2],
    fixtureBoard.columns[3],
  ],
  wonCount: fixtureBoard.wonCount,
};

const sendButton = (): HTMLElement => screen.getByRole("button", { name: /^send$/i });

// ---- the tests --------------------------------------------------------------

describe("WorkBoard", () => {
  it("renders four columns with needs-action groups pinned first", () => {
    render(<WorkBoard data={fixtureBoard} firstRun={false} onOpen={vi.fn()} ctx={{}} />);

    expect(screen.getAllByRole("region", { name: /column/i })).toHaveLength(4);
    const labels = screen.getAllByText(/needs action/i);
    expect(labels.length).toBeGreaterThan(0);

    const quoting = screen.getByRole("region", { name: /estimates & quotes column/i });
    expect(labelsIn(quoting)[0]).toMatch(/needs action/i);
  });

  it("labels the passive group in each column's own words", () => {
    render(<WorkBoard data={fixtureBoard} firstRun={false} onOpen={vi.fn()} ctx={{}} />);

    expect(labelsIn(screen.getByRole("region", { name: /estimates & quotes column/i })).join(" "))
      .toMatch(/waiting for customer/i);
    expect(labelsIn(screen.getByRole("region", { name: /^jobs column$/i })).join(" "))
      .toMatch(/scheduled \/ in field/i);
    expect(labelsIn(screen.getByRole("region", { name: /billing column/i })).join(" "))
      .toMatch(/awaiting payment/i);
  });

  it("states what the column holds — the count and the money", () => {
    render(<WorkBoard data={fixtureBoard} firstRun={false} onOpen={vi.fn()} ctx={{}} />);
    const quoting = screen.getByRole("region", { name: /estimates & quotes column/i });
    expect(quoting.querySelector(".sum")?.textContent).toBe("2 · $5,780");
  });

  it("says a truncated column is a page, as a fact and not an apology", () => {
    render(<WorkBoard data={fixtureBoard} firstRun={false} onOpen={vi.fn()} ctx={{}} />);
    expect(screen.getByText("Showing first 2")).toBeTruthy();
    // The columns that fit say nothing at all.
    expect(screen.queryByText("Showing first 1")).toBeNull();
  });

  it("renders a card per item", () => {
    const { container } = render(<WorkBoard data={fixtureBoard} firstRun={false} onOpen={vi.fn()} ctx={{}} />);
    expect(container.querySelectorAll(".kcard")).toHaveLength(6);
  });

  it("hands the whole item back when a card is opened", async () => {
    const onOpen = vi.fn();
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<WorkBoard data={fixtureBoard} firstRun={false} onOpen={onOpen} ctx={{}} />);

    await user.click(screen.getByRole("button", { name: "Dana Fox" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: "bj-j1" }));
  });

});

/**
 * THE FIRST-RUN BOARD. A brand-new shop's four columns are empty, and four empty columns teach
 * nothing — worse, they read as a board that failed to load. So each column shows ONE dimmed,
 * dashed EXAMPLE card: the shape the work will take, drawn rather than seeded.
 *
 * These are a DRAWING, not records, and every assertion below defends that distinction. A ghost
 * that carried a dollar figure would put an invented number on a shop's first screen; a ghost the
 * screen reader announced, or that a click could open, would be a record that doesn't exist.
 */
describe("WorkBoard — the first-run board", () => {
  it("renders one EXAMPLE ghost per column and no live cards", () => {
    const { container } = render(<WorkBoard data={emptyBoard} firstRun onOpen={vi.fn()} ctx={{}} />);

    expect(screen.getAllByText("Example")).toHaveLength(4);
    expect(container.querySelectorAll(".kcard.ghosted")).toHaveLength(4);
    // Nothing live: no un-ghosted card, and nothing to press anywhere on the board.
    expect(container.querySelectorAll(".kcard:not(.ghosted)")).toHaveLength(0);
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /send/i })).toBeNull();
  });

  it("ghosts never show dollars", () => {
    const { container } = render(<WorkBoard data={emptyBoard} firstRun onOpen={vi.fn()} ctx={{}} />);
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(container.textContent).not.toContain("$");
  });

  it("draws the four columns the live board uses, each stated at 0", () => {
    const { container } = render(<WorkBoard data={emptyBoard} firstRun onOpen={vi.fn()} ctx={{}} />);

    expect(screen.getAllByRole("region", { name: /column/i })).toHaveLength(4);
    expect(Array.from(container.querySelectorAll(".col-head .sum")).map((el) => el.textContent))
      .toEqual(["0", "0", "0", "0"]);
  });

  it("teaches the shape with the mockup's own four examples", () => {
    render(<WorkBoard data={emptyBoard} firstRun onOpen={vi.fn()} ctx={{}} />);

    const examples: readonly (readonly [string, string])[] = [
      ["Dana Ruiz", "Water heater leaking"],
      ["Marcus Lee", "Primary bath remodel"],
      ["Kim Patel", "Main drain cleaning"],
      ["Alex Moro", "Kitchen faucet repair"],
    ];
    for (const [name, service] of examples) {
      expect(screen.getByText(name)).toBeTruthy();
      expect(screen.getByText(service)).toBeTruthy();
    }
  });

  it("keeps every ghost out of the accessibility tree and out of reach", () => {
    const { container } = render(<WorkBoard data={emptyBoard} firstRun onOpen={vi.fn()} ctx={{}} />);

    const ghosts = Array.from(container.querySelectorAll(".kcard.ghosted"));
    expect(ghosts).toHaveLength(4);
    for (const ghost of ghosts) {
      expect(ghost.getAttribute("aria-hidden")).toBe("true");
      // Inert by construction: nothing focusable, nothing to click.
      expect(ghost.querySelector("button, a, [tabindex], [role=button]")).toBeNull();
    }
    // …and the names are drawings, not records the keyboard can open.
    expect(screen.queryByRole("button", { name: "Dana Ruiz" })).toBeNull();
  });

  it("shows the drawing and never the data, even if handed rows", () => {
    // Defensive: `firstRun` is the caller's verdict, but the first-run board renders ghosts only.
    // A stray live card here would leak a real customer's money onto the teaching screen.
    const { container } = render(<WorkBoard data={fixtureBoard} firstRun onOpen={vi.fn()} ctx={{}} />);

    expect(container.querySelectorAll(".kcard.ghosted")).toHaveLength(4);
    expect(container.querySelectorAll(".kcard:not(.ghosted)")).toHaveLength(0);
    expect(screen.queryByText("Maria Ortiz")).toBeNull();
    expect(container.textContent).not.toContain("$");
  });
});

/**
 * THE SENT LEDGER, at the board rather than in the card. Held inside the send block it was
 * unreachable: dismissing on click drops the item from the OK queue, `BoardItem.ok` disappears,
 * the block unmounts with its own "✓ sent" state, and the card changes tone and jumps groups in
 * the same paint. Every assertion here is about the card STAYING PUT until the owner's window
 * closes.
 */
describe("WorkBoard — the undo window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spies.dispatch.mockClear();
    spies.undo.mockClear();
    spies.dismiss.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the card in place and shows the ✓ line with its undo", () => {
    render(<WorkBoard data={boardWithDraft} firstRun={false} onOpen={vi.fn()} ctx={{}} />);
    fireEvent.click(sendButton());

    expect(spies.dispatch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/✓ sent/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /undo/i })).toBeTruthy();
    // The card itself has not moved and has not lost its identity.
    expect(screen.getByRole("button", { name: "Maria Ortiz" })).toBeTruthy();
    // And it is not offering a second send.
    expect(screen.queryByRole("button", { name: /^send$/i })).toBeNull();
  });

  it("does NOT drop the item from the queue on the click", () => {
    render(<WorkBoard data={boardWithDraft} firstRun={false} onOpen={vi.fn()} ctx={{}} />);
    fireEvent.click(sendButton());
    expect(spies.dismiss).not.toHaveBeenCalled();
  });

  it("drops it once the window closes — one witnessed move, not one under the cursor", () => {
    render(<WorkBoard data={boardWithDraft} firstRun={false} onOpen={vi.fn()} ctx={{}} />);
    fireEvent.click(sendButton());

    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS));
    expect(spies.dismiss).toHaveBeenCalledWith("okq-e1");
  });

  it("Undo takes the send back and cancels the pending drop", () => {
    render(<WorkBoard data={boardWithDraft} firstRun={false} onOpen={vi.fn()} ctx={{}} />);
    fireEvent.click(sendButton());
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));

    expect(spies.undo).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS * 2));
    expect(spies.dismiss).not.toHaveBeenCalled();
    // The draft is on offer again — undo returned the card to exactly where it was.
    expect(sendButton()).toBeTruthy();
  });

  it("flushes the pending drop when the board unmounts mid-window — the send stands", () => {
    const { unmount } = render(<WorkBoard data={boardWithDraft} firstRun={false} onOpen={vi.fn()} ctx={{}} />);
    fireEvent.click(sendButton());
    expect(spies.dismiss).not.toHaveBeenCalled();

    unmount();

    // Cancelling here would leave the item in the queue: the card would come back reading
    // "Reminder due" with a live Send over a text the customer already has, and that stale
    // reminder would re-enter the Counter's money run. The text went; the dismissal is owed.
    expect(spies.dismiss).toHaveBeenCalledWith("okq-e1");
    // Flushed, not rolled back — nobody un-sends a text because a route changed.
    expect(spies.undo).not.toHaveBeenCalled();
  });

  it("undo before unmount still cancels it — there is nothing left to flush", () => {
    const { unmount } = render(<WorkBoard data={boardWithDraft} firstRun={false} onOpen={vi.fn()} ctx={{}} />);
    fireEvent.click(sendButton());
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));

    unmount();

    expect(spies.undo).toHaveBeenCalledTimes(1);
    expect(spies.dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS * 2));
    expect(spies.dismiss).not.toHaveBeenCalled();
  });

  it("counts the window down out loud", () => {
    render(<WorkBoard data={boardWithDraft} firstRun={false} onOpen={vi.fn()} ctx={{}} />);
    fireEvent.click(sendButton());
    expect(screen.getByRole("button", { name: /undo · 30s/i })).toBeTruthy();

    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByRole("button", { name: /undo · 25s/i })).toBeTruthy();
  });

  it("puts the draft back and drops the entry when the text never left", async () => {
    spies.dispatch.mockImplementationOnce(() => Promise.reject(new Error("network down")));
    render(<WorkBoard data={boardWithDraft} firstRun={false} onOpen={vi.fn()} ctx={{}} />);
    fireEvent.click(sendButton());

    await act(async () => {
      await Promise.resolve();
    });
    expect(spies.undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/✓ sent/)).toBeNull();
    expect(sendButton()).toBeTruthy();

    // …and no dismissal is left scheduled behind it.
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS * 2));
    expect(spies.dismiss).not.toHaveBeenCalled();
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

describe("GHOST_CARDS", () => {
  it("covers all four columns and carries no money at the source", () => {
    const ids: BoardColumnId[] = ["requests", "quoting", "jobs", "billing"];
    expect(Object.keys(GHOST_CARDS).sort()).toEqual([...ids].sort());
    // The no-dollars rule is enforced in the fixture as well as the render: a ghost with a price
    // in its copy would sail past a CSS-level guard.
    expect(JSON.stringify(GHOST_CARDS)).not.toContain("$");
  });

  it("pins the four example fixtures to their approved literals", () => {
    expect(GHOST_CARDS.requests).toEqual({
      name: "Dana Ruiz",
      service: "Water heater leaking",
      badge: "Needs response",
      tone: "attention",
      state: "Called 5m ago",
    });
    expect(GHOST_CARDS.quoting).toEqual({
      name: "Marcus Lee",
      service: "Primary bath remodel",
      badge: "Quote in progress",
      tone: "attention",
      state: "Draft · unsent",
    });
    expect(GHOST_CARDS.jobs).toEqual({
      name: "Kim Patel",
      service: "Main drain cleaning",
      badge: "Scheduled",
      tone: "waiting",
      state: "Fri · 9:00 AM",
    });
    expect(GHOST_CARDS.billing).toEqual({
      name: "Alex Moro",
      service: "Kitchen faucet repair",
      badge: "Ready to bill",
      tone: "attention",
      state: "Done today",
    });
  });
});

/**
 * The scroll frame, on BOTH boards.
 *
 * Found by the axe net on the first-run screen (`scrollable-region-focusable`), not by review:
 * `.board` scrolls sideways, and a busy live board only passes the rule by accident because its
 * cards happen to carry focusable name buttons. Take the cards away — a first-run shop, or an
 * established one on a cleared day — and the columns off the right edge become unreachable
 * without a mouse. Asserted on both paths so a future change to either cannot quietly drop it.
 */
describe("WorkBoard — the scroll frame", () => {
  it.each([
    ["live", fixtureBoard, false],
    ["first-run", emptyBoard, true],
  ] as const)("the %s board's scrolling columns are reachable by keyboard", (_name, data, firstRun) => {
    const { container } = render(
      <WorkBoard data={data} firstRun={firstRun} onOpen={vi.fn()} ctx={{}} />,
    );
    const frame = container.querySelector(".board");
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute("tabindex")).toBe("0");
    // A bare focus stop announces nothing; the frame says what has been focused.
    expect(frame?.getAttribute("aria-label")).toBe("Work board");
  });
});

describe("WorkBoardSkeleton", () => {
  it("announces itself as busy and draws the board's shape", () => {
    const { container } = render(<WorkBoardSkeleton />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(container.querySelectorAll(".col")).toHaveLength(4);
  });
});
