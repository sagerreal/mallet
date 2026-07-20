"use client";

/**
 * components/shared/load-failed.tsx
 * The state that was missing: a list whose fetch FAILED.
 *
 * Every list surface previously rendered the friendly first-run empty state when
 * its query errored — telling a shop with 400 customers and bad wifi that they
 * have none. This is the honest alternative: name what happened, offer a retry.
 *
 * Pure and dependency-injected like FirstRunEmptyState — the caller supplies the
 * noun and the retry action.
 */

export interface LoadFailedProps {
  /** What failed to load, in the user's words: "customers", "jobs", "invoices". */
  noun: string;
  /** Refetch. Usually `() => query.refetch()`. */
  onRetry: () => void;
  /** Set while the retry is in flight. */
  retrying?: boolean;
}

export function LoadFailed({ noun, onRetry, retrying = false }: LoadFailedProps) {
  return (
    <div className="loadfail" role="alert">
      <p className="loadfail-h">Couldn&apos;t load your {noun}.</p>
      <p className="loadfail-s">
        This is a connection problem, not missing data — nothing has been deleted.
      </p>
      <button className="btn" onClick={onRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Try again"}
      </button>
    </div>
  );
}
