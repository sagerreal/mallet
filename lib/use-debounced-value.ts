"use client";

/**
 * lib/use-debounced-value.ts
 * The search-box contract for every server-paginated list: the INPUT stays
 * instant (bind the raw value), the QUERY trails by `delayMs` (bind the
 * returned value) — so typing doesn't mint a new server query per keystroke.
 */

import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
