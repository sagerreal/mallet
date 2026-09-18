// @vitest-environment jsdom
/**
 * The keyboard inset is pure arithmetic over two numbers the browser reports, and it is the kind
 * of thing that silently inverts. These tests pin the three cases that matter: iOS (layout viewport
 * unchanged), a platform that honours interactive-widget (both shrink), and no keyboard at all.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardInset } from "./use-keyboard-inset";

interface FakeVV {
  height: number;
  offsetTop: number;
  addEventListener: (t: string, f: () => void) => void;
  removeEventListener: (t: string, f: () => void) => void;
}

/** Installs a fake visual viewport and returns a handle that can fire its resize. */
function stubViewport(innerHeight: number, vvHeight: number, offsetTop = 0) {
  const listeners: (() => void)[] = [];
  const vv: FakeVV = {
    height: vvHeight,
    offsetTop,
    addEventListener: (_t, f) => listeners.push(f),
    removeEventListener: (_t, f) => {
      const i = listeners.indexOf(f);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  Object.defineProperty(window, "innerHeight", { value: innerHeight, configurable: true, writable: true });
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true, writable: true });
  return {
    vv,
    fire: () => listeners.forEach((f) => f()),
    listenerCount: () => listeners.length,
  };
}

const kb = () => document.documentElement.style.getPropertyValue("--kb");

afterEach(() => {
  document.documentElement.style.removeProperty("--kb");
  Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true, writable: true });
});

describe("useKeyboardInset", () => {
  // iOS: the layout viewport keeps its full height, only the visual one shrinks. This is the case
  // the viewport meta cannot handle and the whole hook exists for.
  it("publishes the keyboard height when only the VISUAL viewport shrinks", () => {
    stubViewport(852, 516);
    renderHook(() => useKeyboardInset());
    expect(kb()).toBe("336px");
  });

  // Chrome with interactive-widget=resizes-content: innerHeight shrinks too, so the difference is
  // ~0 and nothing must move — otherwise the composer would be shifted twice.
  it("publishes nothing when the LAYOUT viewport shrinks along with it", () => {
    stubViewport(516, 516);
    renderHook(() => useKeyboardInset());
    expect(kb()).toBe("0px");
  });

  it("ignores a small delta — a collapsing URL bar is not a keyboard", () => {
    stubViewport(852, 810); // 42px of browser chrome
    renderHook(() => useKeyboardInset());
    expect(kb()).toBe("0px");
  });

  it("accounts for a shifted visual viewport, not just a shrunken one", () => {
    stubViewport(852, 500, 40);
    renderHook(() => useKeyboardInset());
    expect(kb()).toBe("312px");
  });

  it("follows the keyboard as it animates, so the composer rides up with it", () => {
    const h = stubViewport(852, 852);
    renderHook(() => useKeyboardInset());
    expect(kb()).toBe("0px");
    h.vv.height = 700;
    h.fire();
    expect(kb()).toBe("152px");
    h.vv.height = 516;
    h.fire();
    expect(kb()).toBe("336px");
    // Dismissed.
    h.vv.height = 852;
    h.fire();
    expect(kb()).toBe("0px");
  });

  it("detaches its listeners and clears the property on unmount", () => {
    const h = stubViewport(852, 516);
    const { unmount } = renderHook(() => useKeyboardInset());
    expect(h.listenerCount()).toBe(2); // resize + scroll
    unmount();
    expect(h.listenerCount()).toBe(0);
    expect(kb()).toBe("");
  });

  // Every desktop browser without the API, and older mobile ones: --kb must stay unset so each
  // max() falls through to its resting value rather than collapsing to 0.
  it("does nothing at all when there is no VisualViewport", () => {
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true, writable: true });
    const spy = vi.spyOn(document.documentElement.style, "setProperty");
    renderHook(() => useKeyboardInset());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
