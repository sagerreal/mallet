// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

/**
 * The task drawer: reads v1.agentTasks.get, shows the readable turns, and wires the drawer's two
 * mutually-exclusive controls (reply box, approve/deny on a pending proposal) to v1.agentTasks.reply
 * — there is no separate `approve` procedure, per the router's own doc comment.
 */

const { getQuery, replyMutate, closeMutate, getInvalidate, listInvalidate } = vi.hoisted(() => ({
  getQuery: vi.fn(),
  replyMutate: vi.fn(),
  closeMutate: vi.fn(),
  getInvalidate: vi.fn(),
  listInvalidate: vi.fn(),
}));

// Mutable across tests (reassigned in beforeEach), read only inside deferred closures below —
// same split as pipeline-board.test.tsx's boardQ: mock fns come from vi.hoisted, plain state doesn't.
let mutState = { replyPending: false, closePending: false };

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      v1: { agentTasks: { get: { invalidate: getInvalidate }, list: { invalidate: listInvalidate } } },
    }),
    v1: {
      agentTasks: {
        get: { useQuery: () => getQuery() },
        reply: { useMutation: () => ({ mutate: replyMutate, isPending: mutState.replyPending }) },
        close: { useMutation: () => ({ mutate: closeMutate, isPending: mutState.closePending }) },
      },
    },
  },
}));

import { TaskDrawer } from "./task-drawer";

const task = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  title: "Follow up with the Hendersons",
  status: "needs_you",
  nextActionAt: null,
  nextActionNote: "I need your OK to send this",
  version: 2,
  updatedAt: "2026-08-20T17:00:00Z",
  createdAt: "2026-08-19T17:00:00Z",
  ...over,
});

const pendingItem = (over: Record<string, unknown> = {}) => ({
  toolUseId: "tu_1",
  tool: "send_sms",
  summary: "Text the Hendersons about their water heater quote",
  ...over,
});

const resolved = (t: ReturnType<typeof task>, messages: unknown[] = [], pending: unknown[] = []) => ({
  data: { task: t, messages, pending },
  isLoading: false,
  isError: false,
  isFetched: true,
  isRefetching: false,
  refetch: vi.fn(),
});

describe("TaskDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutState = { replyPending: false, closePending: false };
  });

  it("shows the loader on a cold load", () => {
    getQuery.mockReturnValue({
      data: undefined, isLoading: true, isError: false, isFetched: false, isRefetching: false, refetch: vi.fn(),
    });
    render(<TaskDrawer taskId="t1" onClose={vi.fn()} />);
    expect(screen.queryByText("Follow up with the Hendersons")).toBeNull();
  });

  it("shows a retry when the task failed to load", () => {
    getQuery.mockReturnValue({
      data: undefined, isLoading: false, isError: true, isFetched: true, isRefetching: false, refetch: vi.fn(),
    });
    render(<TaskDrawer taskId="t1" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("renders the readable turns", () => {
    getQuery.mockReturnValue(
      resolved(task(), [
        { role: "user", text: "please chase them" },
        { role: "assistant", text: "I texted them" },
      ]),
    );
    render(<TaskDrawer taskId="t1" onClose={vi.fn()} />);
    expect(screen.getByText("please chase them")).toBeTruthy();
    expect(screen.getByText("I texted them")).toBeTruthy();
  });

  it("shows no approve/deny controls when nothing is pending", () => {
    getQuery.mockReturnValue(resolved(task()));
    render(<TaskDrawer taskId="t1" onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Not this one" })).toBeNull();
  });

  it("shows Approve / Not this one for a pending proposal", () => {
    getQuery.mockReturnValue(resolved(task(), [], [pendingItem()]));
    render(<TaskDrawer taskId="t1" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not this one" })).toBeTruthy();
    expect(screen.getByText("Text the Hendersons about their water heater quote")).toBeTruthy();
  });

  it("approving sends the tool use id and the version that was read", () => {
    getQuery.mockReturnValue(resolved(task({ version: 7 }), [], [pendingItem({ toolUseId: "tu_9" })]));
    render(<TaskDrawer taskId="t1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(replyMutate).toHaveBeenCalledWith(
      { taskId: "t1", version: 7, approvedToolUseIds: ["tu_9"] },
      expect.anything(),
    );
  });

  it("denying sends deniedToolUseIds instead of approvedToolUseIds", () => {
    getQuery.mockReturnValue(resolved(task({ version: 3 }), [], [pendingItem({ toolUseId: "tu_5" })]));
    render(<TaskDrawer taskId="t1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Not this one" }));
    expect(replyMutate).toHaveBeenCalledWith(
      { taskId: "t1", version: 3, deniedToolUseIds: ["tu_5"] },
      expect.anything(),
    );
  });

  it("a CONFLICT from the server shows the server's own sentence, not invented copy", () => {
    getQuery.mockReturnValue(resolved(task(), [], [pendingItem()]));
    render(<TaskDrawer taskId="t1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const onError = replyMutate.mock.calls.at(-1)![1].onError as (e: unknown) => void;
    act(() => {
      onError({
        message: "Artie is working on this right now — give it a moment and reload.",
        data: { code: "CONFLICT" },
      });
    });
    expect(screen.getByText("Artie is working on this right now — give it a moment and reload.")).toBeTruthy();
  });

  it("disables the reply box while a mutation is in flight", () => {
    mutState.replyPending = true;
    getQuery.mockReturnValue(resolved(task()));
    render(<TaskDrawer taskId="t1" onClose={vi.fn()} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("closing the task sends the version that was read", () => {
    getQuery.mockReturnValue(resolved(task({ version: 5, status: "working" })));
    render(<TaskDrawer taskId="t1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Close this task" }));
    expect(closeMutate).toHaveBeenCalledWith({ taskId: "t1", version: 5 }, expect.anything());
  });

  it("hides the composer and the close control for a finished task, and says so", () => {
    getQuery.mockReturnValue(resolved(task({ status: "closed" })));
    render(<TaskDrawer taskId="t1" onClose={vi.fn()} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close this task" })).toBeNull();
    expect(screen.getByText("This task is finished.")).toBeTruthy();
  });

  it("renders NO reply box while a proposal is undecided — the approval pair is the only transcript action", () => {
    // Prose sent on top of an unanswered tool_use is refused by the server
    // (assertNotAwaitingDecision) because persisting it would strand the tool_use and brick the
    // task for ever. A box that cannot succeed must not be rendered.
    getQuery.mockReturnValue(resolved(task(), [], [pendingItem()]));
    render(<TaskDrawer taskId="t1" onClose={vi.fn()} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    // The absence is STATED, not left to be inferred from a missing control.
    expect(screen.getByText("Answer the above before replying.")).toBeTruthy();
    // The approval pair, and the one way out that never touches the transcript, both stay.
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not this one" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close this task" })).toBeTruthy();
  });

  it("brings the reply box back once nothing is pending", () => {
    getQuery.mockReturnValue(resolved(task()));
    render(<TaskDrawer taskId="t1" onClose={vi.fn()} />);
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(screen.queryByText("Answer the above before replying.")).toBeNull();
  });

  it("two or more pending proposals get ONE shared Approve all / Not any of these pair", () => {
    getQuery.mockReturnValue(
      resolved(task(), [], [pendingItem({ toolUseId: "tu_a" }), pendingItem({ toolUseId: "tu_b", summary: "Also mark the invoice paid" })]),
    );
    render(<TaskDrawer taskId="t1" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Approve all 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not any of these" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText("Text the Hendersons about their water heater quote")).toBeTruthy();
    expect(screen.getByText("Also mark the invoice paid")).toBeTruthy();
  });

  it("approving a group sends every pending id together, not one at a time", () => {
    getQuery.mockReturnValue(
      resolved(task({ version: 4 }), [], [pendingItem({ toolUseId: "tu_a" }), pendingItem({ toolUseId: "tu_b" })]),
    );
    render(<TaskDrawer taskId="t1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve all 2" }));
    expect(replyMutate).toHaveBeenCalledWith(
      { taskId: "t1", version: 4, approvedToolUseIds: ["tu_a", "tu_b"] },
      expect.anything(),
    );
  });

  it("back returns to the board without touching the server", () => {
    const onClose = vi.fn();
    getQuery.mockReturnValue(resolved(task()));
    render(<TaskDrawer taskId="t1" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "‹ Back to Artie's tasks" }));
    expect(onClose).toHaveBeenCalled();
    expect(replyMutate).not.toHaveBeenCalled();
    expect(closeMutate).not.toHaveBeenCalled();
  });
});
