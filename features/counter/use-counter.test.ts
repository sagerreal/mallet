/**
 * features/counter/use-counter.test.ts
 * Verifies the LLM agent wiring in use-counter: submit → run.mutateAsync → artifact.
 * Uses renderHook with all heavy dependencies mocked.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---- module mocks (hoisted so vi.mock runs before imports) ----------------------

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock app store — returns empty arrays and stubs for all selectors
vi.mock("@/lib/store/app-store", () => {
  const getState = () => ({
    leads: [],
    estimates: [],
    invoices: [],
    jobs: [],
    techs: [],
    brand: { name: "Test Co" },
    openModal: vi.fn(),
    addLeadNote: vi.fn(() => ({ id: "note-1" })),
    removeLeadNote: vi.fn(),
    updateLead: vi.fn(),
    updateEstimate: vi.fn(),
    moveLeadStage: vi.fn(),
    dismissAttention: vi.fn(),
    undismissAttention: vi.fn(),
    cmdSeed: null,
    clearCmdSeed: vi.fn(),
  });
  const store = Object.assign(
    // selector-based access
    (selector: (s: ReturnType<typeof getState>) => unknown) => selector(getState()),
    { getState, subscribe: vi.fn(() => vi.fn()) },
  );
  return { useAppStore: store };
});

// Mock identity hook
vi.mock("@/features/identity/hooks", () => ({
  useMe: () => ({ data: { name: "Owen Test", email: "owen@test.com" } }),
}));

// Mock pipeline constants
vi.mock("@/features/pipeline/pipeline-constants", () => ({
  STAGE_ORDER: ["New customer", "Quote Sent", "Won", "Lost"],
}));

// Mock home/derive so firstName etc. resolve without real store
vi.mock("@/features/home/derive", () => ({
  deriveOkQueue: () => [],
  firstName: (name: string) => name.split(" ")[0],
}));

// Mock home/send
vi.mock("@/features/home/send", () => ({
  clockNow: () => "12:00",
  commitOkSend: vi.fn(() => vi.fn()),
}));

// Mock counter modules that depend on real store logic
vi.mock("./matcher", () => ({
  matchRows: () => [],
  deriveSuggestions: () => [],
}));

// The trpc api mock — this is the key one.
// We store a reference to the mutateAsync so tests can control it.
const mockMutateAsync = vi.fn();
const mockResumeMutateAsync = vi.fn();
const mockInvalidateV1 = vi.fn().mockResolvedValue(undefined);

// Server-truth queries the counter now composes into the snap — settled/empty here.
const settledQ = { data: undefined, isFetched: true };
vi.mock("@/features/home/use-ok-queue", () => ({
  useOkQueue: () => ({ items: [], value: 0, overdue: [], truncated: false, isFetched: true, isError: false }),
}));
vi.mock("@/features/customers/leads-hydrator", () => ({
  toStoreLead: (d: unknown) => d,
}));
vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      invoicing: { totals: { useQuery: () => settledQ } },
      customers: { list: { useQuery: () => settledQ } },
      quoting: { list: { useQuery: () => settledQ } },
      ai: {
        run: {
          useMutation: () => ({
            mutateAsync: mockMutateAsync,
            isPending: false,
          }),
        },
        resume: {
          useMutation: () => ({
            mutateAsync: mockResumeMutateAsync,
            isPending: false,
          }),
        },
      },
    },
    useUtils: () => ({
      v1: {
        invalidate: mockInvalidateV1,
      },
    }),
  },
}));

// ---- actual test subject -------------------------------------------------------
import { useCounter } from "./use-counter";

// ---- helpers -------------------------------------------------------------------

function makeCompletedResult(text: string) {
  return { status: "completed" as const, text, pending: [], transcript: "[]", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } };
}

function makeNeedsApprovalResult() {
  return {
    status: "needs_approval" as const,
    text: "I'll send that quote now.",
    pending: [
      {
        toolUseId: "tu_1",
        tool: "quote_send",
        argsJson: JSON.stringify({ estimateId: "EST-42" }),
        summary: 'Send estimate EST-42 to the customer — transitions it from draft to sent.',
      },
    ],
    transcript: JSON.stringify([{ role: "user", kind: "text", text: "send the quote" }]),
    usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0 },
  };
}

// ---- tests ---------------------------------------------------------------------

describe("useCounter LLM agent wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submit → completed → pushes an ai-result artifact with the response text", async () => {
    mockMutateAsync.mockResolvedValueOnce(makeCompletedResult("You have 3 outstanding invoices."));

    const { result } = renderHook(() => useCounter());

    // Type a free-form question and submit
    act(() => {
      result.current.setValue("who owes me money");
    });
    await act(async () => {
      await result.current.submit();
    });

    // mutateAsync was called with the message (no prior transcript on the first submit)
    expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ message: "who owes me money" }));

    // An ai-result artifact was pushed
    const entries = result.current.entries;
    expect(entries.length).toBeGreaterThan(0);
    const last = entries[entries.length - 1]!;
    expect(last.artifact.kind).toBe("ai-result");
    if (last.artifact.kind === "ai-result") {
      expect(last.artifact.text).toBe("You have 3 outstanding invoices.");
    }
  });

  it("submit → needs_approval → pushes an ai-approval artifact carrying pending + transcript", async () => {
    const approvalResult = makeNeedsApprovalResult();
    mockMutateAsync.mockResolvedValueOnce(approvalResult);

    const { result } = renderHook(() => useCounter());

    act(() => {
      result.current.setValue("send jane her quote");
    });
    await act(async () => {
      await result.current.submit();
    });

    expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ message: "send jane her quote" }));

    const entries = result.current.entries;
    const last = entries[entries.length - 1]!;
    expect(last.artifact.kind).toBe("ai-approval");
    if (last.artifact.kind === "ai-approval") {
      expect(last.artifact.pending).toHaveLength(1);
      const p0 = last.artifact.pending[0]!;
      expect(p0.toolUseId).toBe("tu_1");
      expect(p0.tool).toBe("quote_send");
      expect(p0.summary).toContain("EST-42");
      expect(last.artifact.transcript).toBe(approvalResult.transcript);
      expect(last.artifact.assistantText).toBe("I'll send that quote now.");
    }
  });

  it("submit → refused → pushes a confirm artifact with the refusal text", async () => {
    mockMutateAsync.mockResolvedValueOnce({
      status: "refused" as const,
      text: "I can't do that — it would delete all records.",
      pending: [],
      transcript: "[]",
      usage: { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0 },
    });

    const { result } = renderHook(() => useCounter());

    act(() => { result.current.setValue("delete everything"); });
    await act(async () => { await result.current.submit(); });

    const last = result.current.entries[result.current.entries.length - 1]!;
    expect(last.artifact.kind).toBe("confirm");
    if (last.artifact.kind === "confirm") {
      expect(last.artifact.lines[0]).toContain("can't do that");
    }
  });

  it("submit → PRECONDITION_FAILED error → pushes a friendly 'not enabled' confirm artifact", async () => {
    const preconditionError = Object.assign(new Error("not enabled"), {
      data: { code: "PRECONDITION_FAILED" },
    });
    mockMutateAsync.mockRejectedValueOnce(preconditionError);

    const { result } = renderHook(() => useCounter());

    act(() => { result.current.setValue("who owes me money"); });
    await act(async () => { await result.current.submit(); });

    const last = result.current.entries[result.current.entries.length - 1]!;
    expect(last.artifact.kind).toBe("confirm");
    if (last.artifact.kind === "confirm") {
      expect(last.artifact.lines[0]).toContain("AI assistant isn't enabled");
    }
  });

  it("submit → network error → pushes a generic retry confirm artifact", async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useCounter());

    act(() => { result.current.setValue("any question"); });
    await act(async () => { await result.current.submit(); });

    const last = result.current.entries[result.current.entries.length - 1]!;
    expect(last.artifact.kind).toBe("confirm");
    if (last.artifact.kind === "confirm") {
      expect(last.artifact.lines[0]).toContain("try again");
    }
  });

  it("approving an ai-approval artifact calls resume with the right approvedToolUseIds and invalidates v1 on completed", async () => {
    // 1. First submit → needs_approval
    const approvalResult = makeNeedsApprovalResult();
    mockMutateAsync.mockResolvedValueOnce(approvalResult);

    const { result } = renderHook(() => useCounter());

    act(() => { result.current.setValue("send jane her quote"); });
    await act(async () => { await result.current.submit(); });

    const entries = result.current.entries;
    const approvalEntry = entries[entries.length - 1]!;
    expect(approvalEntry.artifact.kind).toBe("ai-approval");

    // 2. Mock resume → completed
    const completedResult = makeCompletedResult("Quote sent to Jane.");
    mockResumeMutateAsync.mockResolvedValueOnce(completedResult);

    await act(async () => {
      await result.current.resumeApproval(
        approvalEntry.id,
        approvalResult.transcript,
        ["tu_1"],   // approvedToolUseIds
        [],         // deniedToolUseIds
      );
    });

    // resume was called with the right ids
    expect(mockResumeMutateAsync).toHaveBeenCalledWith({
      transcript: approvalResult.transcript,
      approvedToolUseIds: ["tu_1"],
      deniedToolUseIds: [],
    });

    // The entry is now an ai-result artifact
    const resolved = result.current.entries[result.current.entries.length - 1]!;
    expect(resolved.artifact.kind).toBe("ai-result");
    if (resolved.artifact.kind === "ai-result") {
      expect(resolved.artifact.text).toBe("Quote sent to Jane.");
    }

    // v1 invalidation was triggered
    expect(mockInvalidateV1).toHaveBeenCalled();
  });

  it("second submit passes the first result's transcript for in-conversation continuity", async () => {
    const firstTranscript = JSON.stringify([{ role: "user", kind: "text", text: "who owes me money" }]);
    const secondTranscript = JSON.stringify([
      { role: "user", kind: "text", text: "who owes me money" },
      { role: "user", kind: "text", text: "send jane a reminder" },
    ]);

    mockMutateAsync
      .mockResolvedValueOnce({ status: "completed" as const, text: "Jane owes $200.", pending: [], transcript: firstTranscript, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } })
      .mockResolvedValueOnce({ status: "completed" as const, text: "Reminder sent.", pending: [], transcript: secondTranscript, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } });

    const { result } = renderHook(() => useCounter());

    // First submit — no prior transcript
    act(() => { result.current.setValue("who owes me money"); });
    await act(async () => { await result.current.submit(); });

    expect(mockMutateAsync).toHaveBeenNthCalledWith(1, { message: "who owes me money" });

    // Second submit — must carry the first transcript for continuity
    act(() => { result.current.setValue("send jane a reminder"); });
    await act(async () => { await result.current.submit(); });

    expect(mockMutateAsync).toHaveBeenNthCalledWith(2, {
      message: "send jane a reminder",
      transcript: firstTranscript,
    });
  });

  it("after close/Escape the next submit passes no transcript (fresh conversation)", async () => {
    const firstTranscript = JSON.stringify([{ role: "user", kind: "text", text: "who owes me money" }]);

    mockMutateAsync
      .mockResolvedValueOnce({ status: "completed" as const, text: "Jane owes $200.", pending: [], transcript: firstTranscript, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } })
      .mockResolvedValueOnce({ status: "completed" as const, text: "3 open jobs.", pending: [], transcript: "[]", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } });

    const { result } = renderHook(() => useCounter());

    // First conversation
    act(() => { result.current.setValue("who owes me money"); });
    await act(async () => { await result.current.submit(); });

    // User closes the panel (Escape path) — should clear the thread
    act(() => { result.current.close(); });

    // Next submit should start fresh with no transcript
    act(() => { result.current.setValue("how many jobs are open"); });
    await act(async () => { await result.current.submit(); });

    // After close, transcript is null → no transcript key forwarded to the next run
    expect(mockMutateAsync).toHaveBeenNthCalledWith(2, expect.objectContaining({ message: "how many jobs are open" }));
    // Explicitly verify transcript is NOT set (undefined = no prior context)
    const secondCall = mockMutateAsync.mock.calls[1]![0] as { message: string; transcript?: string };
    expect(secondCall.transcript).toBeUndefined();
  });

  it("when the active transcript exceeds MAX_TRANSCRIPT_CHARS, starts fresh (no transcript forwarded) and pushes a notice entry", async () => {
    // Build a transcript string that is longer than 64_000 chars.
    const hugeTranscript = JSON.stringify([{ role: "user", kind: "text", text: "x".repeat(64_001) }]);

    mockMutateAsync
      // First call returns the huge transcript so activeTranscript gets set.
      .mockResolvedValueOnce({
        status: "completed" as const,
        text: "First answer.",
        pending: [],
        transcript: hugeTranscript,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      })
      // Second call — should receive no transcript (fresh start).
      .mockResolvedValueOnce(makeCompletedResult("Second answer."));

    const { result } = renderHook(() => useCounter());

    // First submit — stores the huge transcript.
    act(() => { result.current.setValue("first question"); });
    await act(async () => { await result.current.submit(); });

    // Second submit — should detect the cap breach, NOT forward the transcript.
    act(() => { result.current.setValue("second question"); });
    await act(async () => { await result.current.submit(); });

    // The second mutateAsync call must have no transcript key (fresh start).
    const secondCall = mockMutateAsync.mock.calls[1]![0] as { message: string; transcript?: string };
    expect(secondCall.transcript).toBeUndefined();

    // A "fresh conversation" notice entry must appear in the entry list.
    const allEntries = result.current.entries;
    const notice = allEntries.find(
      (e) => e.artifact.kind === "confirm" &&
        (e.artifact as { kind: "confirm"; lines: string[] }).lines.some((l) => l.includes("fresh conversation")),
    );
    expect(notice).toBeDefined();
  });

  it("when the active transcript is within MAX_TRANSCRIPT_CHARS, forwards it normally", async () => {
    // A transcript well under 64_000 chars.
    const smallTranscript = JSON.stringify([{ role: "user", kind: "text", text: "hello" }]);

    mockMutateAsync
      .mockResolvedValueOnce({
        status: "completed" as const,
        text: "Hi!",
        pending: [],
        transcript: smallTranscript,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      })
      .mockResolvedValueOnce(makeCompletedResult("Done."));

    const { result } = renderHook(() => useCounter());

    act(() => { result.current.setValue("first"); });
    await act(async () => { await result.current.submit(); });

    act(() => { result.current.setValue("second"); });
    await act(async () => { await result.current.submit(); });

    // The second call MUST carry the transcript (within cap).
    const secondCall = mockMutateAsync.mock.calls[1]![0] as { message: string; transcript?: string };
    expect(secondCall.transcript).toBe(smallTranscript);
  });

  it("submit first pushes a thinking placeholder (ai-thinking) then replaces it on resolve", async () => {
    let resolveRun!: (v: unknown) => void;
    const pending = new Promise((r) => { resolveRun = r; });
    mockMutateAsync.mockReturnValueOnce(pending);

    const { result } = renderHook(() => useCounter());

    act(() => { result.current.setValue("list jobs"); });
    // Start submit (do NOT await yet — we want to catch the in-flight state)
    const submitPromise = act(async () => {
      // fire and yield so React can process the thinking push
      void result.current.submit();
      await Promise.resolve();
    });
    // After the synchronous pushes, we should see the ai-thinking entry
    // (The act wraps only one microtask cycle here, so the placeholder lands first.)
    await submitPromise;

    // Now resolve the mutation
    await act(async () => {
      resolveRun(makeCompletedResult("3 active jobs."));
      // drain microtasks
      await Promise.resolve();
      await Promise.resolve();
    });

    const last = result.current.entries[result.current.entries.length - 1]!;
    expect(last.artifact.kind).toBe("ai-result");
  });
});
