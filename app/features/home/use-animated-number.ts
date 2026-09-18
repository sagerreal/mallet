/**
 * features/home/use-animated-number.ts
 * rAF tween for the hero figure. The displayed value chases the store-derived
 * target (600ms cubic ease-out), so a Send visibly drains it and an Undo
 * refills it — the animation is a visualization of committed state, never
 * theater ahead of it. Respects prefers-reduced-motion.
 */

"use client";

import { useEffect, useRef, useState } from "react";

export function useAnimatedNumber(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || displayRef.current === target) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    const from = displayRef.current;
    const t0 = performance.now();

    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      displayRef.current = v;
      setDisplay(v);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return Math.round(display);
}
