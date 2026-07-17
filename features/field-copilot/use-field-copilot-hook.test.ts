// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// The hook's only external dependency is the vanilla tRPC client.
const runMock = vi.fn();
vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: { v1: { fieldCopilot: { run: { mutate: (...a: unknown[]) => runMock(...a) } } } },
}));

import { useFieldCopilot } from "./use-field-copilot";

describe("useFieldCopilot — photo cap + ask flow", () => {
  beforeEach(() => runMock.mockReset());

  it("attachPhoto caps at 3 — the 4th is dropped", () => {
    const { result } = renderHook(() => useFieldCopilot("job-1"));
    act(() => {
      result.current.attachPhoto("p1");
      result.current.attachPhoto("p2");
      result.current.attachPhoto("p3");
      result.current.attachPhoto("p4"); // dropped
    });
    expect(result.current.attachedPhotos.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("attachPhoto ignores a duplicate id", () => {
    const { result } = renderHook(() => useFieldCopilot("job-1"));
    act(() => {
      result.current.attachPhoto("p1");
      result.current.attachPhoto("p1");
    });
    expect(result.current.attachedPhotos).toHaveLength(1);
  });

  it("ask parses the reply, records the transcript, and clears attached photos", async () => {
    runMock.mockResolvedValue({
      status: "completed",
      text: "Replace the anode rod.\nFOUND WORK: Replace anode rod",
      transcript: [{ role: "user", kind: "text", text: "x" }],
    });
    const { result } = renderHook(() => useFieldCopilot("job-1"));
    act(() => result.current.attachPhoto("p1"));
    await act(async () => {
      await result.current.ask("what's wrong here?");
    });
    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(assistant?.foundWork).toBe("Replace anode rod");
    expect(assistant?.text).not.toContain("FOUND WORK");
    expect(result.current.attachedPhotos).toHaveLength(0); // cleared after the turn
  });
});
