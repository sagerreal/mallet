// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// The hook's only external dependency is the vanilla tRPC client.
const runMock = vi.fn();
vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: { v1: { fieldCopilot: { run: { mutate: (...a: unknown[]) => runMock(...a) } } } },
}));

import { useFieldCopilot } from "./use-field-copilot";

// jsdom implements neither half of the object-URL API. Stub both so the hook's preview lifecycle
// is observable — a leaked URL is a real bug on a screen a tech keeps open all day.
let urlSeq = 0;
const revoked: string[] = [];
beforeEach(() => {
  urlSeq = 0;
  revoked.length = 0;
  URL.createObjectURL = vi.fn(() => `blob:${++urlSeq}`);
  URL.revokeObjectURL = vi.fn((u: string) => {
    revoked.push(u);
  });
});

const blob = () => new Blob(["x"], { type: "image/jpeg" });

describe("useFieldCopilot — attachments", () => {
  beforeEach(() => runMock.mockReset());

  it("caps at 3 across BOTH kinds — the 4th is dropped and its preview freed", () => {
    const { result } = renderHook(() => useFieldCopilot("job-1"));
    act(() => {
      result.current.attachJobPhoto("p1", blob());
      result.current.attachInlinePhoto("AAAA", "image/jpeg", blob());
      result.current.attachJobPhoto("p3", blob());
      result.current.attachInlinePhoto("BBBB", "image/jpeg", blob()); // dropped
    });
    expect(result.current.attachedPhotos).toHaveLength(3);
    expect(result.current.photosFull).toBe(true);
    // The rejected attachment must not leak the object URL it minted.
    expect(revoked).toContain("blob:4");
  });

  it("detach frees that preview and leaves the rest attached", () => {
    const { result } = renderHook(() => useFieldCopilot());
    act(() => {
      result.current.attachInlinePhoto("AAAA", "image/jpeg", blob());
      result.current.attachInlinePhoto("BBBB", "image/jpeg", blob());
    });
    const first = result.current.attachedPhotos[0]!;
    act(() => result.current.detachPhoto(first.key));
    expect(result.current.attachedPhotos).toHaveLength(1);
    expect(revoked).toContain(first.previewUrl);
  });

  it("splits the two kinds into photoIds and photos on the wire", async () => {
    runMock.mockResolvedValue({ status: "completed", text: "ok", transcript: [] });
    const { result } = renderHook(() => useFieldCopilot("job-1"));
    act(() => {
      result.current.attachJobPhoto("p1", blob());
      result.current.attachInlinePhoto("AAAA", "image/jpeg", blob());
    });
    await act(async () => {
      await result.current.ask("what is this?");
    });
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        photoIds: ["p1"],
        photos: [{ dataBase64: "AAAA", mediaType: "image/jpeg" }],
      }),
    );
  });

  it("omits jobId entirely on the general chat", async () => {
    runMock.mockResolvedValue({ status: "completed", text: "ok", transcript: [] });
    const { result } = renderHook(() => useFieldCopilot());
    await act(async () => {
      await result.current.ask("code for a gas water heater vent?");
    });
    expect(runMock.mock.calls[0]?.[0]).not.toHaveProperty("jobId");
  });
});

describe("useFieldCopilot — ask flow", () => {
  beforeEach(() => runMock.mockReset());

  it("records the reply and the transcript, and clears attached photos", async () => {
    runMock.mockResolvedValue({
      status: "completed",
      text: "Replace the **anode rod**.",
      transcript: [{ role: "user", kind: "text", text: "x" }],
    });
    const { result } = renderHook(() => useFieldCopilot("job-1"));
    act(() => result.current.attachJobPhoto("p1", blob()));
    await act(async () => {
      await result.current.ask("what's wrong here?");
    });
    const assistant = result.current.messages.find((m) => m.role === "assistant");
    // Markdown emphasis is stripped — the phone screen renders plain text.
    expect(assistant?.text).toBe("Replace the anode rod.");
    expect(result.current.attachedPhotos).toHaveLength(0); // rode with the turn
  });

  it("keeps the photos attached when the ask FAILS — re-taking them would be busywork", async () => {
    // Once, and lazily. A standing reject implementation mints a fresh rejected promise on every
    // call, and any call the hook does not await is reported as an unhandled rejection.
    runMock.mockImplementationOnce(() =>
      Promise.reject(new Error("the AI assistant is temporarily unavailable")),
    );
    const { result } = renderHook(() => useFieldCopilot());
    act(() => result.current.attachInlinePhoto("AAAA", "image/jpeg", blob()));
    await act(async () => {
      await result.current.ask("what is this part?");
    });
    expect(result.current.error).toContain("temporarily unavailable");
    expect(result.current.attachedPhotos).toHaveLength(1);
    // The optimistic user message rolls back so the question can be sent again.
    expect(result.current.messages).toHaveLength(0);
  });
});
