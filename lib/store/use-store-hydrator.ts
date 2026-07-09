"use client";

/**
 * lib/store/use-store-hydrator.ts
 * Generic hook that syncs a paginated tRPC list query into a Zustand slice.
 * Handles errors (dev diagnostic), cursor-truncation warnings, and the
 * transform+setSlice pattern — DRY across LeadsHydrator / JobsHydrator.
 */

import { useEffect } from "react";
import { HYDRATOR_PAGE_LIMIT } from "./hydrator-config";

interface UseStoreHydratorOptions<TItem, TStore> {
  /** Raw paginated response from tRPC (undefined while loading). */
  data: { items: TItem[]; nextCursor: string | null } | undefined;
  /** True when the query failed. */
  isError: boolean;
  /** The error value when isError is true. */
  error: unknown;
  /** Pure function: converts one DTO to the store shape. */
  transform: (item: TItem) => TStore;
  /** Zustand action to replace the slice (module-level selector, stable ref). */
  setSlice: (items: TStore[]) => void;
  /** Human-readable label used in dev console messages (e.g. "leads", "jobs"). */
  label: string;
}

/**
 * Syncs a paginated tRPC response into a Zustand store slice.
 *
 * - On error: emits a dev-only console.error (no server logger in client code).
 * - On nextCursor non-null: emits a dev warning that results are truncated
 *   (pilot ceiling is HYDRATOR_PAGE_LIMIT).
 * - On data: maps items through `transform` and calls `setSlice`.
 *
 * `transform` and `setSlice` must be stable references (module-level fn +
 * zustand selector) so they are safe as useEffect deps.
 */
export function useStoreHydrator<TItem, TStore>({
  data,
  isError,
  error,
  transform,
  setSlice,
  label,
}: UseStoreHydratorOptions<TItem, TStore>): void {
  useEffect(() => {
    if (isError) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.error(`[hydrator:${label}] load failed`, error);
      }
      return;
    }

    if (!data) return;

    if (data.nextCursor !== null) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          `[hydrator:${label}] result truncated at ${HYDRATOR_PAGE_LIMIT} items — ` +
            `cursor iteration needed for full data set.`,
        );
      }
    }

    setSlice(data.items.map(transform));
  }, [data, isError, error, transform, setSlice, label]);
}
