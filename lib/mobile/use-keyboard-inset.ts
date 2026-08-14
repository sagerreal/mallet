"use client";

/**
 * lib/mobile/use-keyboard-inset.ts
 * Publishes the on-screen keyboard's height as `--kb` on the document root.
 *
 * WHY THIS EXISTS. The root layout already asks for `interactive-widget=resizes-content`, which
 * shrinks the LAYOUT viewport when the keyboard opens so `position:fixed` bottom chrome lands above
 * it. Chrome honours that. **iOS Safari and WKWebView do not.** There the layout viewport keeps its
 * full height and only the VISUAL viewport shrinks, so a fixed composer stays pinned under the
 * keyboard until iOS gets round to scrolling the focused field into view — which is the second-long
 * lag where the keyboard covers the input before it finally pops up.
 *
 * The VisualViewport API is the one thing iOS does report, and it fires continuously through the
 * keyboard animation, so a composer positioned from `--kb` rides up with the keyboard instead of
 * jumping after it. Once the field is never covered, iOS has no reason to scroll at all.
 *
 * The formula self-neutralises on platforms that DO resize the layout viewport: there `innerHeight`
 * shrinks along with the visual viewport, so the difference is ~0 and nothing shifts twice.
 */

import { useEffect } from "react";

/** Below this, a delta is browser chrome (a collapsing URL bar), not a keyboard. */
const KEYBOARD_FLOOR_PX = 60;

/**
 * Mount once, app-wide. Sets `--kb` to the keyboard's height in px (`0px` when closed).
 *
 * Consumers position against it with `max()`, so a closed keyboard leaves the resting layout
 * untouched: `bottom: max(calc(60px + var(--safe-b)), var(--kb))`.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    // No VisualViewport (older browsers, and every desktop case that matters): leave --kb at its
    // CSS default of 0px so every max() falls through to the resting value.
    if (!vv) return;

    let last = -1;
    const apply = () => {
      const raw = window.innerHeight - vv.height - vv.offsetTop;
      const inset = raw >= KEYBOARD_FLOOR_PX ? Math.round(raw) : 0;
      // Writing an unchanged value on every scroll frame would churn style recalc for nothing.
      if (inset === last) return;
      last = inset;
      root.style.setProperty("--kb", `${inset}px`);
    };

    apply();
    vv.addEventListener("resize", apply);
    // iOS shifts the visual viewport without resizing it when the page is scrolled with the
    // keyboard already open — offsetTop moves, so the inset has to be recomputed.
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      root.style.removeProperty("--kb");
    };
  }, []);
}
