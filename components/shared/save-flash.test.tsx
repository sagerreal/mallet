// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, render, screen } from "@testing-library/react";
import { useSaveFlash, SavedFlash } from "./save-flash";

describe("useSaveFlash", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts not-saved, flashes true, then clears after the duration", () => {
    const { result } = renderHook(() => useSaveFlash(2000));
    expect(result.current.saved).toBe(false);

    act(() => result.current.flash());
    expect(result.current.saved).toBe(true);

    act(() => vi.advanceTimersByTime(1999));
    expect(result.current.saved).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.saved).toBe(false);
  });

  it("reset() clears the flash immediately and cancels the pending timer", () => {
    const { result } = renderHook(() => useSaveFlash(2000));
    act(() => result.current.flash());
    expect(result.current.saved).toBe(true);

    act(() => result.current.reset());
    expect(result.current.saved).toBe(false);

    // The pending timer must not re-fire and flip state back.
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.saved).toBe(false);
  });

  it("a second flash() restarts the window (the earlier timer is cleared)", () => {
    const { result } = renderHook(() => useSaveFlash(2000));
    act(() => result.current.flash());
    act(() => vi.advanceTimersByTime(1500));
    act(() => result.current.flash()); // restart
    act(() => vi.advanceTimersByTime(1500)); // 3000 since first, 1500 since second
    expect(result.current.saved).toBe(true); // still within the restarted window
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.saved).toBe(false);
  });

  it("clears the pending timer on unmount (no setState after unmount)", () => {
    const { result, unmount } = renderHook(() => useSaveFlash(2000));
    act(() => result.current.flash());
    unmount();
    // If the timer weren't cleared, this would fire a setState on an unmounted
    // component. Advancing here must be a no-op.
    expect(() => act(() => vi.advanceTimersByTime(2000))).not.toThrow();
  });
});

describe("SavedFlash", () => {
  it("renders nothing when not saved", () => {
    const { container } = render(<SavedFlash saved={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the marker when saved", () => {
    render(<SavedFlash saved />);
    expect(screen.getByText("Saved ✓")).toBeTruthy();
  });
});
