// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The Pipeline board — the Customers page's shop-defined kanban.
 *
 * What these tests hold: the first-run setup gate (progressive disclosure — no stages means
 * templates, never an empty board), the board's honesty devices (derived pill on every card,
 * counts on every head), and the drop contract (a drop writes the placement mutation; a drop on
 * the card's own column writes nothing).
 */

interface BoardData {
  stages: { id: string; name: string; position: number; count: number }[];
  unstaged: number;
}
let boardQ: { data: BoardData | undefined; isLoading: boolean; isError: boolean; refetch: () => void };
const seedMutate = vi.fn();
const setStageMutate = vi.fn();
const openModal = vi.fn();
let listPages: { items: unknown[]; nextCursor: string | null }[];

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      v1: {
        customers: {
          pipeline: { board: { invalidate: vi.fn() } },
          list: { invalidate: vi.fn() },
        },
      },
    }),
    v1: {
      customers: {
        pipeline: {
          board: { useQuery: () => boardQ },
          seed: { useMutation: () => ({ mutate: seedMutate, isPending: false }) },
          createStage: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
          renameStage: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
          removeStage: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
          moveStage: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
          setLeadStage: { useMutation: () => ({ mutate: setStageMutate, isPending: false }) },
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

describe("PipelineBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPages = [{ items: [], nextCursor: null }];
    boardQ = { data: { stages: [], unstaged: 0 }, isLoading: false, isError: false, refetch: vi.fn() };
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
    expect(setStageMutate).toHaveBeenCalledWith({ leadId: "l1", stageId: "s1" });
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
