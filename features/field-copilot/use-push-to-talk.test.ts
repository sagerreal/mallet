// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePushToTalk } from "./use-push-to-talk";

// A controllable fake of webkitSpeechRecognition.
class FakeRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  // test helpers
  emit(text: string, isFinal = false) {
    this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: text }, isFinal }] });
  }
}

describe("usePushToTalk", () => {
  let instances: FakeRecognition[] = [];
  beforeEach(() => {
    instances = [];
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = class {
      constructor() {
        const r = new FakeRecognition();
        instances.push(r);
        return r as unknown as object;
      }
    };
  });
  afterEach(() => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  it("reports supported=false when neither API exists", () => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    const { result } = renderHook(() => usePushToTalk(() => {}));
    expect(result.current.supported).toBe(false);
  });

  it("reports supported=true when webkitSpeechRecognition exists", () => {
    const { result } = renderHook(() => usePushToTalk(() => {}));
    expect(result.current.supported).toBe(true);
  });

  it("start() begins listening and streams the transcript to the callback", () => {
    const onText = vi.fn();
    const { result } = renderHook(() => usePushToTalk(onText));
    act(() => result.current.start());
    expect(result.current.listening).toBe(true);
    expect(instances[0]!.start).toHaveBeenCalled();
    act(() => instances[0]!.emit("replace the anode"));
    expect(onText).toHaveBeenCalledWith("replace the anode");
  });

  it("onend clears listening; stop() calls the engine", () => {
    const { result } = renderHook(() => usePushToTalk(() => {}));
    act(() => result.current.start());
    act(() => result.current.stop());
    expect(instances[0]!.stop).toHaveBeenCalled();
    act(() => instances[0]!.onend?.());
    expect(result.current.listening).toBe(false);
  });

  it("surfaces a friendly error on not-allowed; stays quiet on no-speech", () => {
    const { result } = renderHook(() => usePushToTalk(() => {}));
    act(() => result.current.start());
    act(() => instances[0]!.onerror?.({ error: "no-speech" }));
    expect(result.current.error).toBeNull();
    act(() => result.current.start());
    act(() => instances[1]!.onerror?.({ error: "not-allowed" }));
    expect(result.current.error).toMatch(/microphone/i);
  });
});
