"use client";

/**
 * lib/use-ticking-now.ts
 * A clock that advances, for any figure derived from "how long since".
 *
 * Recomputed from `new Date()` rather than counted up, so a slept phone, a backgrounded tab and a
 * reload all land on the same number — a counter would drift on every one of them.
 *
 * Every 15s rather than every second: these figures are shown to the minute, and this keeps the
 * boundary tight without a per-second re-render of a card that is on screen all day.
 *
 * ANY figure derived from this needs `data-dynamic` on its element, or the visual baseline fails
 * on every run as the number grows (see dynamicRegions in e2e/helpers/ui.ts).
 */

import { useEffect, useState } from "react";

export const TICK_MS = 15_000;

export function useTickingNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}
