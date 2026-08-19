// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The Pipeline board — the Customers page's shop-defined kanban.
 *
 * What these tests hold: the first-run setup gate (progressive disclosure — no stages means
 * templates, never an empty board), the board's honesty devices (derived pill on every card,
 * counts on every head), the drop contract (a drop writes the placement mutation; a drop on
 * the card's own column writes nothing), and the EDIT LOOP'S SPEED CONTRACT — every stage edit
 * lands in the board cache immediately (optimistic, rolled back on error) and settles without
 * refetching the whole customers.list namespace. The edit buttons were visibly laggy in prod
 * because each press waited a full round trip and then refetched every column.
 */

interface BoardData {
  stages: { id: string; name: string; position: number; count: number }[];
  unstaged: number;
}
let boardQ: { data: BoardData | undefined; isLoading: boolean; isError: boolean; refetch: () => void };
const { seedMutate, setStageMutate } = vi.hoisted(() => ({ seedMutate: vi.fn(), setStageMutate: vi.fn() }));
const openModal = vi.fn();
let listPages: { items: unknown[]; nextCursor: string | null }[];

/**
 * Every useMutation's options captured by name (the optimistic handlers live in there), plus the
 * cache utils as stable spies. vi.hoisted, because the vi.mock factory is hoisted above this file.
 */
const { mutationOpts, mkUseMutation, utilsBoard, utilsList } = vi.hoisted(() => {
  // Loose on purpose: each entry is whatever options object that mutation was mounted with.
  const mutationOpts: Record<string, any> = {};
  const mkUseMutation =
    (name: string, mutate: ReturnType<typeof vi.fn>) =>
    (opts?: unknown) => {
      mutationOpts[name] = opts ?? {};
      return { mutate, isPending: false };
    };
  const utilsBoard = {
    cancel: vi.fn(async () => {}),
    getData: vi.fn(),
    setData: vi.fn(),
    invalidate: vi.fn(),
  };
  const utilsList = { invalidate: vi.fn() };
  return { mutationOpts, mkUseMutation, utilsBoard, utilsList };
});

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      v1: {
        customers: {
          pipeline: { board: utilsBoard },
          list: utilsList,
        },
      },
    }),
    v1: {
      customers: {
        pipeline: {
          board: { useQuery: () => boardQ },
          seed: { useMutation: mkUseMutation("seed", seedMutate) },
          createStage: { useMutation: mkUseMutation("createStage", vi.fn()) },
          renameStage: { useMutation: mkUseMutation("renameStage", vi.fn()) },
          removeStage: { useMutation: mkUseMutation("removeStage", vi.fn()) },
          moveStage: { useMutation: mkUseMutation("moveStage", vi.fn()) },
          setLeadStage: { useMutation: mkUseMutation("setLeadStage", setStageMutate) },
        },
        list: {
          useInfiniteQuery: () => ({
            data: { pages: listPages },
            isLoading: false,
            hasNextPage: false,
            isFetchingNextPage: false,
            fetchNextPage: vi.fn(),
          }),
        },
      },
    },
  },
}));
vi.mock("@/lib/store/app-store", () => ({ useOpenModal: () => openModal }));

import { PipelineBoard } from "./pipeline-board";

const lead = (id: string, name: string, group: string | null = "quoteOut") => ({
  id, name, address: "12 Pine St, Oakland, CA", group,
});

const stage = (id: string, name: string, position: number, count: number) => ({ id, name, position, count });

/** Runs the last setData call's updater against a board — how the cache write is observed. */
const lastSetData = (d: BoardData): BoardData | undefined => {
  const call = utilsBoard.setData.mock.calls.at(-1);
  expect(call).toBeTruthy();
  const updater = call![1] as unknown;
  return typeof updater === "function" ? (updater as (x: BoardData) => BoardData)(d) : (updater as BoardData);
};

describe("PipelineBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(mutationOpts)) delete mutationOpts[k];
    listPages = [{ items: [], nextCursor: null }];
    boardQ = { data: { stages: [], unstaged: 0 }, isLoading: false, isError: false, refetch: vi.fn() };
    utilsBoard.getData.mockImplementation(() => boardQ.data);
  });

  it("no stages = the setup screen, never an empty board", () => {
    render(<PipelineBoard />);
    expect(screen.getByText("Set up your pipeline")).toBeTruthy();
    expect(screen.queryByTestId("pipeline-board")).toBeNull();
  });

  it("picking a template seeds it", () => {
    render(<PipelineBoard />);
    fireEvent.click(screen.getByText("Insurance claim"));
    expect(seedMutate).toHaveBeenCalledWith({ template: "insurance" });
  });

  it("with stages: a leading Not-staged column, then the shop's columns with counts", () => {
    boardQ.data = {
      stages: [
        { id: "s1", name: "Adjuster meeting", position: 0, count: 3 },
        { id: "s2", name: "Supplement filed", position: 1, count: 1 },
      ],
      unstaged: 9,
    };
    render(<PipelineBoard />);
    expect(screen.getByText("Not staged")).toBeTruthy();
    expect(screen.getByText("Adjuster meeting")).toBeTruthy();
    expect(screen.getByText("Supplement filed")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
  });

  it("a card carries the DERIVED fact pill — the column is intention, the pill is truth", () => {
    boardQ.data = { stages: [{ id: "s1", name: "Follow-up", position: 0, count: 1 }], unstaged: 0 };
    listPages = [{ items: [lead("l1", "Marta Feldkamp", "owesMoney")], nextCursor: null }];
    render(<PipelineBoard />);
    expect(screen.getAllByText("Owes money").length).toBeGreaterThan(0);
  });

  it("dropping a card on another column writes the placement", () => {
    boardQ.data = { stages: [{ id: "s1", name: "Follow-up", position: 0, count: 0 }], unstaged: 1 };
    listPages = [{ items: [lead("l1", "Marta Feldkamp")], nextCursor: null }];
    render(<PipelineBoard />);
    const target = screen.getByTestId("pipeline-col-s1");
    fireEvent.drop(target, {
      dataTransfer: {
        getData: () => JSON.stringify({ id: "l1", name: "Marta Feldkamp", address: null, group: null, from: null }),
      },
    });
    expect(setStageMutate).toHaveBeenCalledWith({ leadId: "l1", stageId: "s1" }, expect.anything());
  });

  it("dropping a card back on its own column writes NOTHING — a no-op, not a churn write", () => {
    boardQ.data = { stages: [{ id: "s1", name: "Follow-up", position: 0, count: 1 }], unstaged: 0 };
    listPages = [{ items: [lead("l1", "Marta Feldkamp")], nextCursor: null }];
    render(<PipelineBoard />);
    fireEvent.drop(screen.getByTestId("pipeline-col-s1"), {
      dataTransfer: {
        getData: () => JSON.stringify({ id: "l1", name: "Marta Feldkamp", address: null, group: null, from: "s1" }),
      },
    });
    expect(setStageMutate).not.toHaveBeenCalled();
  });

  it("a foreign drag (text, a file) is ignored, not crashed on", () => {
    boardQ.data = { stages: [{ id: "s1", name: "Follow-up", position: 0, count: 0 }], unstaged: 0 };
    render(<PipelineBoard />);
    fireEvent.drop(screen.getByTestId("pipeline-col-s1"), { dataTransfer: { getData: () => "" } });
    expect(setStageMutate).not.toHaveBeenCalled();
  });

  it("tapping a card's name opens the customer sheet — the non-drag path to the stage picker", () => {
    boardQ.data = { stages: [{ id: "s1", name: "Follow-up", position: 0, count: 1 }], unstaged: 0 };
    listPages = [{ items: [lead("l1", "Marta Feldkamp")], nextCursor: null }];
    render(<PipelineBoard />);
    // The mock list serves every column the same page, so the card renders in each — an artifact
    // of the shared stub, not of the board. Any instance proves the wiring.
    fireEvent.click(screen.getAllByRole("button", { name: "Marta Feldkamp" })[0]!);
    expect(openModal).toHaveBeenCalledWith("lead", { leadId: "l1" });
  });

  it("every stage head has an Edit button — rename/move/delete reachable without a mouse", () => {
    boardQ.data = { stages: [{ id: "s1", name: "Follow-up", position: 0, count: 0 }], unstaged: 0 };
    render(<PipelineBoard />);
    fireEvent.click(screen.getByRole("button", { name: "Edit stage Follow-up" }));
    expect(screen.getByLabelText("Stage name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move Follow-up left" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });
});

/**
 * The edit loop's speed contract. Every press answers from the CACHE, immediately; the server
 * settles afterwards. And settling is narrow: renaming or reordering a column does not change
 * which customers are in it, so it must not refetch a single customer page.
 */
describe("PipelineBoard edit loop — optimistic and narrow", () => {
  const board = (): BoardData => ({
    stages: [stage("s1", "Follow-up", 0, 2), stage("s2", "Quote sent", 1, 5)],
    unstaged: 3,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(mutationOpts)) delete mutationOpts[k];
    listPages = [{ items: [], nextCursor: null }];
    boardQ = { data: board(), isLoading: false, isError: false, refetch: vi.fn() };
    utilsBoard.getData.mockImplementation(() => boardQ.data);
    render(<PipelineBoard />);
  });

  it("rename lands in the cache before the server answers, and snapshots for rollback", async () => {
    const ctx = await mutationOpts.renameStage.onMutate({ id: "s1", name: "Won" });
    expect(utilsBoard.cancel).toHaveBeenCalled();
    const next = lastSetData(board());
    expect(next?.stages.map((s) => s.name)).toEqual(["Won", "Quote sent"]);
    expect(ctx.prev).toEqual(board());
  });

  it("a failed rename puts the snapshot back", async () => {
    const ctx = await mutationOpts.renameStage.onMutate({ id: "s1", name: "Won" });
    mutationOpts.renameStage.onError(new Error("boom"), { id: "s1", name: "Won" }, ctx);
    expect(utilsBoard.setData).toHaveBeenLastCalledWith(undefined, board());
  });

  it("move reorders the cache immediately, and adopts the server's order on success", async () => {
    await mutationOpts.moveStage.onMutate({ id: "s2", direction: "up" });
    expect(lastSetData(board())?.stages.map((s) => s.id)).toEqual(["s2", "s1"]);

    mutationOpts.moveStage.onSuccess(
      [stage("s2", "Quote sent", 0, 0), stage("s1", "Follow-up", 1, 0)].map(({ count: _c, ...rest }) => rest),
      { id: "s2", direction: "up" },
      { prev: board() },
    );
    const settled = lastSetData(board());
    expect(settled?.stages.map((s) => s.id)).toEqual(["s2", "s1"]);
    // Counts survive the reorder — the server's move answer carries none.
    expect(settled?.stages.map((s) => s.count)).toEqual([5, 2]);
  });

  it("rename and move settle WITHOUT refetching customer columns", async () => {
    mutationOpts.renameStage.onSuccess?.(stage("s1", "Won", 0, 2), { id: "s1", name: "Won" }, { prev: board() });
    mutationOpts.moveStage.onSuccess?.([], { id: "s2", direction: "up" }, { prev: board() });
    expect(utilsList.invalidate).not.toHaveBeenCalled();
  });

  it("remove drops the column and folds its count into Not staged immediately", async () => {
    await mutationOpts.removeStage.onMutate({ id: "s2" });
    const next = lastSetData(board());
    expect(next?.stages.map((s) => s.id)).toEqual(["s1"]);
    expect(next?.unstaged).toBe(8);
  });

  it("remove settles by refetching ONLY the Not staged column", () => {
    mutationOpts.removeStage.onSuccess({ id: "s2" }, { id: "s2" }, { prev: board() });
    expect(utilsBoard.invalidate).toHaveBeenCalled();
    const call = utilsList.invalidate.mock.calls.at(-1)!;
    const predicate = call[1].predicate as (q: { queryKey: unknown[] }) => boolean;
    const key = (input: Record<string, unknown>) => ({ queryKey: [["v1", "customers", "list"], { input, type: "infinite" }] });
    expect(predicate(key({ pipelineStage: "none", limit: 25 }))).toBe(true);
    expect(predicate(key({ pipelineStage: "s1", limit: 25 }))).toBe(false);
    // The List tab's pages carry no pipelineStage — never dragged into a board settle.
    expect(predicate(key({ limit: 50 }))).toBe(false);
  });

  it("a new stage lands in the cache straight from the response — no refetch storm", () => {
    mutationOpts.createStage.onSuccess({ id: "s9", name: "Permits", position: 2 }, { name: "Permits" }, undefined);
    const next = lastSetData(board());
    expect(next?.stages.at(-1)).toEqual({ id: "s9", name: "Permits", position: 2, count: 0 });
    expect(utilsList.invalidate).not.toHaveBeenCalled();
  });

  it("a drop settles the board and ONLY the two columns involved", () => {
    listPages = [{ items: [lead("l1", "Marta Feldkamp")], nextCursor: null }];
    boardQ = { data: board(), isLoading: false, isError: false, refetch: vi.fn() };
    render(<PipelineBoard />);
    fireEvent.drop(screen.getAllByTestId("pipeline-col-s2")[0]!, {
      dataTransfer: {
        getData: () => JSON.stringify({ id: "l1", name: "Marta Feldkamp", address: null, group: null, from: null }),
      },
    });
    const callbacks = setStageMutate.mock.calls.at(-1)![1] as { onSuccess: () => void };
    callbacks.onSuccess();
    expect(utilsBoard.invalidate).toHaveBeenCalled();
    const call = utilsList.invalidate.mock.calls.at(-1)!;
    const predicate = call[1].predicate as (q: { queryKey: unknown[] }) => boolean;
    const key = (input: Record<string, unknown>) => ({ queryKey: [["v1", "customers", "list"], { input, type: "infinite" }] });
    expect(predicate(key({ pipelineStage: "none" }))).toBe(true); // where it came from
    expect(predicate(key({ pipelineStage: "s2" }))).toBe(true); // where it landed
    expect(predicate(key({ pipelineStage: "s1" }))).toBe(false); // untouched column stays put
  });
});
